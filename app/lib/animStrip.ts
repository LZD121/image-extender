// app/lib/animStrip.ts
/**
 * Strip geometry, the panel fit, and the strip prompt — the pure half of "one
 * strip becomes N frames".
 *
 * Why one module: the panel fit, the column-mass profile it searches over, the
 * field sampling that feeds it, the cell↔direction order and the prompt that
 * asks the model for that order are one fact each about the same object — a
 * 1×N strip of square cells. The CLI (Phase 4) and the UI (Phase 6) both read
 * them; a private copy is the mistake `app/lib/chromaPresets.ts` already
 * records paying for.
 *
 * Pure: it imports nothing at all — no fs, no network, no DOM, no React. It
 * takes a decoded RGBA buffer and returns numbers and strings, so the whole
 * geometry is unit-testable and the browser bundle can carry it unchanged.
 *
 * Measured inputs this module must reproduce (`.planning/phases/01-transport-probe/`):
 * the probe strip (2928×352) fits at spacing 360 / phase 20, the committed
 * 2048×246 fixture at 255 / 253. Both are *outputs of the search*, never
 * constants — the phase exists partly to make that true.
 */

/** The eight compass directions, in the runtime's sector order (east, clockwise). */
export const DIRS8 = [
  'east',
  'south-east',
  'south',
  'south-west',
  'west',
  'north-west',
  'north',
  'north-east',
] as const

/**
 * The hero's four *named* poses — not a subset of the sectors. The consumer
 * draws these as distinct poses (down/side/up/back), so they are their own list.
 */
export const DIRS4 = ['down', 'side', 'up', 'back'] as const

export type Dir8 = (typeof DIRS8)[number]
export type Dir4 = (typeof DIRS4)[number]
export type Dir = Dir8 | Dir4

/** The preset names a spec may carry. Order IS the contract: it maps to engine rows. */
export const DIRS_PRESETS = ['dirs8', 'dirs4'] as const
export type DirsPreset = (typeof DIRS_PRESETS)[number]

export function isDirsPreset(value: unknown): value is DirsPreset {
  return typeof value === 'string' && (DIRS_PRESETS as readonly string[]).includes(value)
}

/** Expands a preset name to its ordered directions. */
export function dirsForPreset(preset: DirsPreset): readonly Dir[] {
  return preset === 'dirs4' ? DIRS4 : DIRS8
}

/** The direction cell `cell` (0-based) faces: `dirs[cell]`. */
export function directionForCell(dirs: readonly Dir[], cell: number): Dir {
  if (!Number.isInteger(cell) || cell < 0 || cell >= dirs.length) {
    throw new Error(`cell ${cell} is outside a ${dirs.length}-cell strip`)
  }
  return dirs[cell]
}

/** The 0-based cell that faces `dir`, or -1 when the preset does not carry it. */
export function cellForDirection(dirs: readonly Dir[], dir: string): number {
  return (dirs as readonly string[]).indexOf(dir)
}

/** One row of `dirs` square cells of `cell` pixels: `cell*dirs` × `cell`, exactly. */
export function stripSize(cell: number, dirs: number): { width: number; height: number; aspect: number } {
  if (!Number.isInteger(cell) || cell < 1) throw new Error(`cell must be a positive integer, got ${cell}`)
  if (!Number.isInteger(dirs) || dirs < 1) throw new Error(`dirs must be a positive integer, got ${dirs}`)
  const width = cell * dirs
  return { width, height: cell, aspect: width / cell }
}

/** RGBA8, row-major, four bytes per pixel. */
export type PixelBuffer = Uint8Array | Uint8ClampedArray
export type Rgb = readonly [number, number, number]

function assertBuffer(buf: PixelBuffer, width: number, height: number): void {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) {
    throw new Error(`bad buffer size ${width}x${height}`)
  }
  const expected = width * height * 4
  if (buf.length !== expected) {
    throw new Error(`RGBA buffer is ${buf.length} bytes, expected ${expected} for ${width}x${height}`)
  }
}

/**
 * The field colour, from the four corners (each `inset` pixels in, per-channel
 * median). The corners are the safest sample: the prompt keeps every creature
 * inside its own cell with a gutter, so the corners are always field. The
 * model does NOT paint a constant colour — measured across one batch of strips
 * the field drifts between (225,214,225) and (253,5,251) — so this is sampled,
 * never assumed.
 */
export function sampleFieldRgb(buf: PixelBuffer, width: number, height: number, inset = 2): Rgb {
  assertBuffer(buf, width, height)
  if (!Number.isInteger(inset) || inset < 0 || 2 * inset >= Math.min(width, height)) {
    throw new Error(`inset ${inset} does not fit a ${width}x${height} buffer`)
  }
  const at = (x: number, y: number): Rgb => {
    const i = (y * width + x) * 4
    return [buf[i], buf[i + 1], buf[i + 2]]
  }
  const corners = [
    at(inset, inset),
    at(width - 1 - inset, inset),
    at(inset, height - 1 - inset),
    at(width - 1 - inset, height - 1 - inset),
  ]
  const median = [0, 1, 2].map((c) => {
    const v = corners.map((p) => p[c]).sort((a, b) => a - b)
    return Math.round((v[1] + v[2]) / 2)
  })
  return [median[0], median[1], median[2]]
}

/** Sum of per-channel absolute differences — the same metric the profile counts with. */
export function fieldDistance(rgb: Rgb, fieldRgb: Rgb): number {
  return Math.abs(rgb[0] - fieldRgb[0]) + Math.abs(rgb[1] - fieldRgb[1]) + Math.abs(rgb[2] - fieldRgb[2])
}

/** Magenta strength: `max(0, min(r, b) - g)`. Saturated fields measure 244; grey ones under 20. */
export function magentaCast(rgb: Rgb): number {
  return Math.max(0, Math.min(rgb[0], rgb[2]) - rgb[1])
}

/**
 * Per-column content mass: for each column, how many pixels differ from
 * `fieldRgb` by more than `distance` (sum of channels).
 */
export function columnProfile(
  buf: PixelBuffer,
  width: number,
  height: number,
  fieldRgb: Rgb,
  distance = 60
): Int32Array {
  assertBuffer(buf, width, height)
  const out = new Int32Array(width)
  for (let x = 0; x < width; x++) {
    let mass = 0
    for (let y = 0; y < height; y++) {
      const i = (y * width + x) * 4
      if (fieldDistance([buf[i], buf[i + 1], buf[i + 2]], fieldRgb) > distance) mass++
    }
    out[x] = mass
  }
  return out
}

/** One cut. `mass` is null when the line falls outside the profile. */
export type CutLine = { x: number; mass: number | null }

export type PanelFit = {
  /** Fitted cell pitch, in pixels. */
  spacing: number
  /** Fitted offset of the first cut, in pixels. */
  phase: number
  /** Total mass sitting on the cut lines, or null when no in-window grid fits. */
  residual: number | null
  /** `residual` as a percentage of the profile's total mass; null with `residual`. */
  residualPct: number | null
  /** Every cut lands on an almost-empty column. The gate Phase 3 enforces. */
  gutterOk: boolean
  medianMass: number
  /** How many (spacing, phase) pairs were scored. Proof the fit is a search. */
  trials: number
  cutLines: CutLine[]
}

export type FitOptions = {
  /** How many cells the strip has — the count of gutters plus one. */
  cells: number
  /** Half-width of the spacing window, as a fraction of `width / cells`. */
  spanPct?: number
  /** A cut is safe when its mass is at most this fraction of the median column. */
  gutterRatio?: number
}

export const FIT_SPAN_PCT = 0.08
export const GUTTER_RATIO = 0.02

/**
 * Fits `(spacing, phase)` to a column-mass profile by SEARCH — never a constant
 * (D-13). A grid is good when every cut line lands on an empty gutter column,
 * so the objective is the total mass sitting on the cut lines, minimised over
 * the window. Ties are broken by scan order (ascending spacing, then ascending
 * phase), which is what makes the result reproducible.
 */
export function fitPanelGrid(profile: Int32Array, opts: FitOptions): PanelFit {
  const { cells } = opts
  const spanPct = opts.spanPct ?? FIT_SPAN_PCT
  const gutterRatio = opts.gutterRatio ?? GUTTER_RATIO
  const width = profile.length
  if (width < 1) throw new Error('profile is empty')
  if (!Number.isInteger(cells) || cells < 1) throw new Error(`cells must be a positive integer, got ${cells}`)
  if (!(spanPct > 0 && spanPct < 1)) throw new Error(`spanPct must be in (0, 1), got ${spanPct}`)
  if (!(gutterRatio >= 0 && gutterRatio <= 1)) throw new Error(`gutterRatio must be in [0, 1], got ${gutterRatio}`)

  const uniform = width / cells
  const sorted = Array.from(profile).sort((a, b) => a - b)
  const medianMass = sorted[Math.floor(width / 2)]
  let totalMass = 0
  for (let x = 0; x < width; x++) totalMass += profile[x]

  const cutsOf = (spacing: number, phase: number): number[] => {
    const cuts: number[] = []
    for (let k = 1; k < cells; k++) cuts.push(Math.round(phase + k * spacing))
    return cuts
  }
  const massAt = (x: number): number | null => (x > 0 && x < width ? profile[x] : null)

  // One cell means one row and no interior cut — nothing to search.
  if (cells === 1) {
    return { spacing: width, phase: 0, residual: 0, residualPct: 0, gutterOk: true, medianMass, trials: 0, cutLines: [] }
  }

  const first = Math.max(1, Math.round(uniform * (1 - spanPct)))
  const last = Math.round(uniform * (1 + spanPct))
  let best: { spacing: number; phase: number; cutMass: number } | null = null
  let trials = 0
  for (let spacing = first; spacing <= last; spacing++) {
    for (let phase = 0; phase < spacing; phase++) {
      trials++
      let cutMass = 0
      let inside = true
      for (let k = 1; k < cells; k++) {
        const x = Math.round(phase + k * spacing)
        if (x <= 0 || x >= width) {
          inside = false
          break
        }
        cutMass += profile[x]
      }
      if (inside && (best === null || cutMass < best.cutMass)) best = { spacing, phase, cutMass }
    }
  }

  const spacing = best ? best.spacing : Math.round(uniform)
  const phase = best ? best.phase : 0
  const residual = best ? best.cutMass : null
  const cutLines: CutLine[] = cutsOf(spacing, phase).map((x) => ({ x, mass: massAt(x) }))
  const gutterOk =
    best !== null && cutLines.every((c) => c.mass !== null && c.mass <= Math.max(1, medianMass * gutterRatio))
  const residualPct = residual === null || totalMass === 0 ? null : (residual / totalMass) * 100

  return { spacing, phase, residual, residualPct, gutterOk, medianMass, trials, cutLines }
}

/** The key colour the prompt asks for. */
export const FIELD_HEX = '#FF00FF'

/**
 * The sentences that keep the model from painting a scene, a UI card or a grid.
 * Constants on purpose: the per-cell part is generated, these are policy.
 */
export const STRIP_CONSTRAINTS = [
  'Keep the creature COMPLETELY INSIDE its own cell with a wide magenta gutter on all sides - nothing may touch a cell edge or cross into a neighbouring cell.',
  'One creature per cell, centred, full body.',
  'The background is NOT a scene: no floor, no ground plane, no horizon, no walls, no scenery, nothing behind the creature but the flat magenta field.',
  'No ground shadow, no cast shadow, no text, no grid lines, no cell borders, no labels, no card, no plaque, no frame, no panel, no background rectangle or shape of any kind.',
].join(' ')

export type StripPromptBody = {
  subject: string
  motion: string
  /** 0-based frame index; the prompt spells it 1-based because a human reads it. */
  frame: number
  frames: number
  dirs: readonly string[]
  /** Inlined verbatim; the closed `artStyle` table cannot express a game's own style. */
  styleText: string
}

/**
 * The strip prompt. The per-cell direction list is generated from `dirs`, so a
 * 4-cell hero strip cannot inherit an 8-cell enumeration.
 */
export function buildStripPrompt(body: StripPromptBody): string {
  const { subject, motion, frame, frames, dirs, styleText } = body
  const n = dirs.length
  if (n < 1) throw new Error('a strip needs at least one cell')
  if (!Number.isInteger(frame) || !Number.isInteger(frames) || frame < 0 || frame >= frames) {
    throw new Error(`frame ${frame} is outside ${frames} frames`)
  }
  const layout = `a flat 1-row x ${n}-column strip of ${n} equal square cells`
  const style = styleText.trim() ? `${styleText.trim()} ` : ''
  const order = dirs.map((dir, i) => `cell ${i + 1} facing ${dir}`).join(', ')
  return (
    `A 2D game sprite sheet for a dark-fantasy dungeon, laid out as ${layout} on a perfectly flat pure magenta ${FIELD_HEX} background. ` +
    `${style}All ${n} cells show the SAME creature, ${subject} \u2014 ${motion} (animation frame ${frame + 1} of ${frames}). ` +
    `Each cell faces a different direction: ${order}. ${STRIP_CONSTRAINTS}`
  )
}
