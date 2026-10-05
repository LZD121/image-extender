// app/utils/pixelGrid.ts
/**
 * Pure pixel-grid math. No DOM, no canvas: every function takes and returns
 * plain buffers so the whole module is testable in node.
 *
 * The corpus convention is a 2x2 block lattice on a 16-logical-pixel grid.
 * The block size is an INPUT, not something we detect: vendor output has 1px
 * grain, and an image with no 2x2 structure contains no evidence of "2".
 * What must be detected is the PHASE — the corpus lattice sits at (0, 1), and
 * measuring a single offset reports 0.55 on an image whose truth is 1.0000.
 */

export type RGBA = readonly [number, number, number, number]
export type PixelBuffer = { data: Uint8ClampedArray; width: number; height: number }

export const DEFAULT_BLOCK = 2
export const DEFAULT_CELL = 32
export const DEFAULT_FIGURE_BAND = { min: 24, max: 28 } as const
export const PURITY_THRESHOLD = 0.95

function px(buf: PixelBuffer, x: number, y: number): RGBA {
  const i = (y * buf.width + x) * 4
  return [buf.data[i], buf.data[i + 1], buf.data[i + 2], buf.data[i + 3]] as const
}

function same(a: RGBA, b: RGBA): boolean {
  return a[0] === b[0] && a[1] === b[1] && a[2] === b[2] && a[3] === b[3]
}

/** Fraction of `block x block` tiles (at this phase) that are a single colour. */
export function purityAt(buf: PixelBuffer, block: number, ox: number, oy: number): number {
  let total = 0
  let impure = 0
  for (let by = oy; by + block <= buf.height; by += block) {
    for (let bx = ox; bx + block <= buf.width; bx += block) {
      total += 1
      const first = px(buf, bx, by)
      let pure = true
      for (let y = by; y < by + block && pure; y++) {
        for (let x = bx; x < bx + block; x++) {
          if (!same(px(buf, x, y), first)) {
            pure = false
            break
          }
        }
      }
      if (!pure) impure += 1
    }
  }
  return total === 0 ? 0 : 1 - impure / total
}

/** Best of all four phases. Never trust a single-offset measurement. */
export function bestPhase(buf: PixelBuffer, block: number): { ox: number; oy: number; purity: number } {
  let best = { ox: 0, oy: 0, purity: -1 }
  for (let oy = 0; oy < block; oy++) {
    for (let ox = 0; ox < block; ox++) {
      const purity = purityAt(buf, block, ox, oy)
      if (purity > best.purity) best = { ox, oy, purity }
    }
  }
  return best
}

/**
 * Mode of every `block x block` tile — never the average. Averaging also
 * reaches purity 1.0 but inflates the palette (measured 20 -> 54..73 colours).
 */
export function decimateByMode(buf: PixelBuffer, block: number, ox: number, oy: number): PixelBuffer {
  const width = Math.floor((buf.width - ox) / block)
  const height = Math.floor((buf.height - oy) / block)
  const out: PixelBuffer = { data: new Uint8ClampedArray(Math.max(width, 0) * Math.max(height, 0) * 4), width: Math.max(width, 0), height: Math.max(height, 0) }
  for (let by = 0; by < out.height; by++) {
    for (let bx = 0; bx < out.width; bx++) {
      const counts = new Map<string, { colour: RGBA; n: number }>()
      for (let y = 0; y < block; y++) {
        for (let x = 0; x < block; x++) {
          const colour = px(buf, ox + bx * block + x, oy + by * block + y)
          const key = colour.join(',')
          const hit = counts.get(key)
          if (hit) hit.n += 1
          else counts.set(key, { colour, n: 1 })
        }
      }
      let top: { colour: RGBA; n: number } | null = null
      for (const entry of Array.from(counts.values())) if (!top || entry.n > top.n) top = entry
      if (top) out.data.set(top.colour, (by * out.width + bx) * 4)
    }
  }
  return out
}

/** Transparent or magenta: both mean "not the figure". */
export function isBackground(c: RGBA): boolean {
  return c[3] < 8 || (c[0] > 200 && c[1] < 80 && c[2] > 200)
}

function emptyBuffer(width: number, height: number): PixelBuffer {
  return { data: new Uint8ClampedArray(Math.max(width, 0) * Math.max(height, 0) * 4), width: Math.max(width, 0), height: Math.max(height, 0) }
}

/**
 * Place the figure into a `cell x cell` canvas, horizontally centred and
 * bottom-aligned. Integer pixels only: this function NEVER resamples. If the
 * figure is larger than the cell it throws — fix `image_size` so the figure is
 * born at the right height instead of shrinking a finished sprite.
 */
export function cropToCell(
  src: PixelBuffer,
  opts: { cell: number; minFigureHeight?: number; maxFigureHeight?: number },
): { image: PixelBuffer; figure: { width: number; height: number }; warnings: string[] } {
  let minX = src.width
  let minY = src.height
  let maxX = -1
  let maxY = -1
  for (let y = 0; y < src.height; y++) {
    for (let x = 0; x < src.width; x++) {
      if (isBackground(px(src, x, y))) continue
      if (x < minX) minX = x
      if (x > maxX) maxX = x
      if (y < minY) minY = y
      if (y > maxY) maxY = y
    }
  }
  if (maxX < 0) {
    return { image: emptyBuffer(opts.cell, opts.cell), figure: { width: 0, height: 0 }, warnings: ['no figure pixels found'] }
  }
  const figure = { width: maxX - minX + 1, height: maxY - minY + 1 }
  if (figure.width > opts.cell || figure.height > opts.cell) {
    throw new Error(
      `cropToCell: figure ${figure.width}x${figure.height} does not fit ${opts.cell}x${opts.cell}; change image_size instead of rescaling`,
    )
  }
  const warnings: string[] = []
  const band = `${opts.minFigureHeight}-${opts.maxFigureHeight}`
  if (opts.minFigureHeight !== undefined && figure.height < opts.minFigureHeight) {
    warnings.push(`figure ${figure.height}px below the ${band} band`)
  }
  if (opts.maxFigureHeight !== undefined && figure.height > opts.maxFigureHeight) {
    warnings.push(`figure ${figure.height}px above the ${band} band`)
  }
  const image = emptyBuffer(opts.cell, opts.cell)
  const dx = Math.floor((opts.cell - figure.width) / 2)
  const dy = opts.cell - figure.height
  for (let y = 0; y < figure.height; y++) {
    for (let x = 0; x < figure.width; x++) {
      image.data.set(px(src, minX + x, minY + y), ((dy + y) * opts.cell + dx + x) * 4)
    }
  }
  return { image, figure, warnings }
}
