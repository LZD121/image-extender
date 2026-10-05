// app/utils/__tests__/pixelGrid.test.ts
import { describe, expect, it } from 'vitest'
import { analyzeGrid, bestPhase, cropToCell, decimateByMode, isBackground, PURITY_THRESHOLD, purityAt, type PixelBuffer, type RGBA } from '@/app/utils/pixelGrid'

const TRANSPARENT: RGBA = [0, 0, 0, 0]

function makeBuffer(width: number, height: number, fill: RGBA = TRANSPARENT): PixelBuffer {
  const data = new Uint8ClampedArray(width * height * 4)
  for (let i = 0; i < width * height; i++) data.set(fill, i * 4)
  return { data, width, height }
}

function setPx(buf: PixelBuffer, x: number, y: number, c: RGBA): void {
  buf.data.set(c, (y * buf.width + x) * 4)
}

/**
 * An 8x8 image whose logical 2x2 lattice starts at (1,1): nine distinct
 * blocks covering x,y in 1..6, transparent border elsewhere.
 * Only the (1,1) phase tiles it purely.
 */
function offsetLattice(): PixelBuffer {
  const buf = makeBuffer(8, 8)
  for (let j = 0; j < 3; j++) {
    for (let i = 0; i < 3; i++) {
      const c: RGBA = [40 + i * 40, 40 + j * 40, 128, 255]
      for (let y = 0; y < 2; y++) for (let x = 0; x < 2; x++) setPx(buf, 1 + i * 2 + x, 1 + j * 2 + y, c)
    }
  }
  return buf
}

describe('purityAt', () => {
  it('scores the true lattice phase 1.0 and a shifted phase 0', () => {
    const buf = offsetLattice()
    expect(purityAt(buf, 2, 1, 1)).toBe(1)
    expect(purityAt(buf, 2, 0, 0)).toBe(0)
  })
})

describe('bestPhase', () => {
  it('finds the lattice offset instead of trusting (0,0)', () => {
    const best = bestPhase(offsetLattice(), 2)
    expect(best.ox).toBe(1)
    expect(best.oy).toBe(1)
    expect(best.purity).toBe(1)
  })

  it('reports a low score for a smooth image that has no lattice at all', () => {
    const smooth = makeBuffer(8, 8)
    let v = 0
    for (let y = 0; y < 8; y++) {
      for (let x = 0; x < 8; x++) {
        v += 7
        setPx(smooth, x, y, [v % 256, 0, 0, 255])
      }
    }
    expect(bestPhase(smooth, 2).purity).toBeLessThan(0.95)
  })
})

describe('decimateByMode', () => {
  it('takes the block mode and never invents a colour', () => {
    const RED: RGBA = [200, 30, 30, 255]
    const BLUE: RGBA = [30, 30, 200, 255]
    const buf = makeBuffer(2, 2, RED)
    setPx(buf, 1, 1, BLUE) // 3 red, 1 blue
    const out = decimateByMode(buf, 2, 0, 0)
    expect(out.width).toBe(1)
    expect(out.height).toBe(1)
    expect(Array.from(out.data)).toEqual([...RED])
  })

  it('keeps the output colour set a subset of the input', () => {
    const buf = offsetLattice()
    const out = decimateByMode(buf, 2, 1, 1)
    const input = new Set<string>()
    for (let i = 0; i < buf.width * buf.height; i++) {
      input.add(buf.data.slice(i * 4, i * 4 + 4).join(','))
    }
    for (let i = 0; i < out.width * out.height; i++) {
      expect(input.has(out.data.slice(i * 4, i * 4 + 4).join(','))).toBe(true)
    }
  })
})

/** A `w x h` opaque figure at (x, y) on a transparent canvas. */
function withFigure(canvas: number, x: number, y: number, w: number, h: number): PixelBuffer {
  const buf = makeBuffer(canvas, canvas)
  for (let yy = 0; yy < h; yy++) for (let xx = 0; xx < w; xx++) setPx(buf, x + xx, y + yy, [90, 160, 90, 255])
  return buf
}

describe('cropToCell', () => {
  it('places the figure without changing its pixel size', () => {
    const src = withFigure(48, 10, 12, 26, 28)
    const res = cropToCell(src, { cell: 32, minFigureHeight: 24, maxFigureHeight: 28 })
    expect(res.image.width).toBe(32)
    expect(res.image.height).toBe(32)
    expect(res.figure).toEqual({ width: 26, height: 28 })
    expect(res.warnings).toEqual([])
    // bottom-aligned: last figure row is the last canvas row
    const lastRow = Array.from(res.image.data.slice((31 * 32 + 16) * 4, (31 * 32 + 16) * 4 + 4))
    expect(isBackground(lastRow as unknown as RGBA)).toBe(false)
  })

  it('throws rather than rescaling a figure that does not fit', () => {
    const src = withFigure(48, 4, 4, 40, 40)
    expect(() => cropToCell(src, { cell: 32 })).toThrow(/does not fit/)
  })

  it('warns when the figure height leaves the band, but still crops', () => {
    const src = withFigure(48, 10, 10, 20, 31)
    const res = cropToCell(src, { cell: 32, minFigureHeight: 24, maxFigureHeight: 28 })
    expect(res.warnings).toHaveLength(1)
    expect(res.warnings[0]).toContain('31px')
    expect(res.figure).toEqual({ width: 20, height: 31 })
  })
})

describe('analyzeGrid', () => {
  it('passes a real lattice', () => {
    const res = analyzeGrid(offsetLattice(), 2)
    expect(res.ok).toBe(true)
    expect(res.ox).toBe(1)
    expect(res.oy).toBe(1)
    expect(res.purity).toBe(1)
  })

  it('refuses to call a smooth image decimatable', () => {
    const smooth = makeBuffer(16, 16)
    let v = 0
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) { v += 11; setPx(smooth, x, y, [v % 256, 7, 9, 255]) }
    const res = analyzeGrid(smooth, 2)
    expect(res.ok).toBe(false)
    expect(res.purity).toBeLessThan(PURITY_THRESHOLD)
  })
})
