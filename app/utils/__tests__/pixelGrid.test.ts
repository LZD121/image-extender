// app/utils/__tests__/pixelGrid.test.ts
import { describe, expect, it } from 'vitest'
import { bestPhase, decimateByMode, purityAt, type PixelBuffer, type RGBA } from '@/app/utils/pixelGrid'

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
