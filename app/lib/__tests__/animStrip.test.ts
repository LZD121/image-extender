import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import sharp from 'sharp'
import {
  DIRS4, DIRS8, DIRS_PRESETS, buildStripPrompt, cellForDirection, columnProfile, directionForCell,
  dirsForPreset, fitPanelGrid, isDirsPreset, magentaCast, sampleFieldRgb, stripSize,
} from '@/app/lib/animStrip'

const FIELD: [number, number, number] = [252, 6, 250]
const CONTENT: [number, number, number] = [10, 10, 10]

/** A synthetic strip: `isContent(x, y)` paints CONTENT, everything else the field. */
function strip(width: number, height: number, isContent: (x: number, y: number) => boolean): Uint8Array {
  const buf = new Uint8Array(width * height * 4)
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const i = (y * width + x) * 4
    const c = isContent(x, y) ? CONTENT : FIELD
    buf[i] = c[0]; buf[i + 1] = c[1]; buf[i + 2] = c[2]; buf[i + 3] = 255
  }
  return buf
}
/** The column mass of a grid whose cells are `spacing` wide with a `gutter`-wide gap. */
function profile(width: number, spacing: number, phase: number, gutter: number, mass: number): Int32Array {
  const out = new Int32Array(width)
  for (let x = 0; x < width; x++) out[x] = ((x - phase) % spacing + spacing) % spacing < gutter ? 0 : mass
  return out
}

describe('DIRS8 / DIRS4', () => {
  it('are the runtime constants, in the order the engine reads rows in', () => {
    expect(DIRS8).toEqual(['east','south-east','south','south-west','west','north-west','north','north-east'])
    expect(DIRS4).toEqual(['down', 'side', 'up', 'back'])
    expect(DIRS_PRESETS).toEqual(['dirs8', 'dirs4'])
  })
  it('maps a cell index to a direction and back', () => {
    expect(directionForCell(DIRS8, 0)).toBe('east')
    expect(directionForCell(DIRS8, 7)).toBe('north-east')
    expect(cellForDirection(DIRS8, 'north-east')).toBe(7)
    expect(cellForDirection(DIRS8, 'down')).toBe(-1)
    expect(cellForDirection(DIRS4, 'back')).toBe(3)
  })
  it('refuses a cell outside the strip', () => {
    expect(() => directionForCell(DIRS8, -1)).toThrow(/outside/)
    expect(() => directionForCell(DIRS8, 8)).toThrow(/outside/)
  })
  it('expands a preset and rejects anything else', () => {
    expect(dirsForPreset('dirs8')).toEqual(DIRS8)
    expect(dirsForPreset('dirs4')).toEqual(DIRS4)
    expect(isDirsPreset('dirs8')).toBe(true)
    expect(isDirsPreset('dirs16')).toBe(false)
    expect(isDirsPreset(['east'])).toBe(false)
  })
})

describe('stripSize', () => {
  it('is exact: 8 cells of 512 is 4096x512 at 8:1', () => {
    expect(stripSize(512, 8)).toEqual({ width: 4096, height: 512, aspect: 8 })
    expect(stripSize(512, 4)).toEqual({ width: 2048, height: 512, aspect: 4 })
  })
  it('rejects a non-positive side', () => {
    expect(() => stripSize(0, 8)).toThrow(/positive integer/)
    expect(() => stripSize(512, 0)).toThrow(/positive integer/)
  })
})

describe('sampleFieldRgb', () => {
  it('takes the median of the four corners', () => {
    const buf = strip(64, 64, () => false)
    expect(sampleFieldRgb(buf, 64, 64)).toEqual([252, 6, 250])
  })
  it('does not assume a constant field: one stray corner cannot move it', () => {
    // The model's field drifts across a batch, so this is sampled, not assumed.
    // A plain mean over four corners would land on (249,15,250) here.
    const buf = strip(64, 64, () => false)
    const at = (x: number, y: number) => (y * 64 + x) * 4
    buf[at(2, 2)] = 240; buf[at(2, 2) + 1] = 40
    expect(sampleFieldRgb(buf, 64, 64)).toEqual([252, 6, 250])
    // Two drifted corners are half the sample: the median goes with them.
    buf[at(61, 2)] = 240; buf[at(61, 2) + 1] = 40
    expect(sampleFieldRgb(buf, 64, 64)).toEqual([246, 23, 250])
  })
  it('refuses a buffer that does not match the stated size', () => {
    expect(() => sampleFieldRgb(new Uint8Array(4), 4, 4)).toThrow(/4 bytes/)
  })
})

describe('magentaCast', () => {
  it('reads the two fields the corpus actually produced', () => {
    expect(magentaCast([252, 6, 250])).toBe(244)
    expect(magentaCast([223, 199, 210])).toBe(11)
  })
})

describe('columnProfile', () => {
  it('counts only pixels that differ from the field', () => {
    const buf = strip(64, 8, (x) => x >= 10 && x < 20)
    const p = columnProfile(buf, 64, 8, FIELD)
    expect(p.length).toBe(64)
    expect(p[9]).toBe(0); expect(p[10]).toBe(8); expect(p[19]).toBe(8); expect(p[20]).toBe(0)
  })
})

describe('fitPanelGrid', () => {
  it('finds the uniform grid, and the search is real', () => {
    const fit = fitPanelGrid(profile(256, 32, 0, 2, 16), { cells: 8 })
    expect(fit.spacing).toBe(32); expect(fit.phase).toBe(0)
    expect(fit.cutLines.map((c) => c.x)).toEqual([32, 64, 96, 128, 160, 192, 224])
    expect(fit.cutLines.every((c) => c.mass === 0)).toBe(true)
    expect(fit.residual).toBe(0); expect(fit.residualPct).toBe(0)
    expect(fit.gutterOk).toBe(true)
    expect(fit.trials).toBe(224)
    expect(fit.medianMass).toBe(16)
  })
  it('follows a phase-shifted grid off the uniform answer (−3.125%)', () => {
    const fit = fitPanelGrid(profile(256, 31, 2, 2, 16), { cells: 8 })
    expect(fit.spacing).toBe(31); expect(fit.phase).toBe(2)
    expect(fit.cutLines.map((c) => c.x)).toEqual([33, 64, 95, 126, 157, 188, 219])
    expect(fit.residual).toBe(0); expect(fit.gutterOk).toBe(true)
    expect(fit.trials).toBe(224)
  })
  it('tolerates noise: one content pixel per cut is still a gutter', () => {
    const fit = fitPanelGrid(profile(256, 31, 2, 3, 16), { cells: 8 })
    expect(fit.spacing).toBe(31); expect(fit.phase).toBe(2)
    expect(fit.cutLines.map((c) => c.mass)).toEqual([0, 0, 0, 0, 0, 0, 0])
    expect(fit.gutterOk).toBe(true)
  })
  it('reports a failed gutter instead of hiding it', () => {
    // A 27-wide grid on a 256-wide profile: outside the ±8% window, so the
    // search settles on the least-bad grid inside it and every cut is occupied.
    const fit = fitPanelGrid(profile(256, 27, 3, 2, 16), { cells: 8 })
    expect(fit.spacing).toBe(34); expect(fit.phase).toBe(9)
    expect(fit.residual).toBe(80)
    expect(fit.cutLines.map((c) => c.mass)).toEqual([16, 16, 0, 16, 16, 16, 0])
    expect(fit.gutterOk).toBe(false)
    expect(fit.trials).toBe(224)
  })
  it('scales the same way the real strips do: 360/20 on a 2928-wide profile', () => {
    const fit = fitPanelGrid(profile(2928, 360, 20, 2, 352), { cells: 8 })
    expect(fit.spacing).toBe(360); expect(fit.phase).toBe(20)
    expect(fit.trials).toBe(21594)
    expect(fit.medianMass).toBe(352)
  })
  it('is parameterised: a narrower window does not find an out-of-window grid', () => {
    const grid = profile(256, 34, 9, 2, 16)
    const narrow = fitPanelGrid(grid, { cells: 8 })
    expect(narrow.trials).toBe(224)
    const wide = fitPanelGrid(grid, { cells: 8, spanPct: 0.2 })
    expect(wide.trials).toBe(416)
  })
  it('one cell means no interior cut', () => {
    const fit = fitPanelGrid(profile(256, 32, 0, 2, 16), { cells: 1 })
    expect(fit.cutLines).toEqual([]); expect(fit.trials).toBe(0); expect(fit.gutterOk).toBe(true)
  })
  it('rejects nonsense options instead of returning one', () => {
    expect(() => fitPanelGrid(profile(256, 32, 0, 2, 16), { cells: 0 })).toThrow(/positive integer/)
    expect(() => fitPanelGrid(profile(256, 32, 0, 2, 16), { cells: 8, spanPct: 1 })).toThrow(/spanPct/)
    expect(() => fitPanelGrid(new Int32Array(0), { cells: 8 })).toThrow(/empty/)
  })
})

describe('the probe strip Phase 1 measured, when it is still on this machine', () => {
  // `.ie/probe/` is gitignored — the raw strip is deliberately not in the repo,
  // so this case skips on a fresh clone instead of failing there. The numbers
  // come from .planning/phases/01-transport-probe/evidence/measured-raw.json.
  const RAW = '.ie/probe/chaser_idle_f1_8dir.png'
  it.runIf(existsSync(RAW))('reproduces the recorded raw fit (360 / 20, gutter false) — by search', async () => {
    const { data, info } = await sharp(RAW, { limitInputPixels: false }).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
    expect(info.width).toBe(2928); expect(info.height).toBe(352)
    const field = sampleFieldRgb(data, info.width, info.height)
    expect(field).toEqual([252, 6, 250])
    const fit = fitPanelGrid(columnProfile(data, info.width, info.height, field), { cells: 8 })
    expect(fit.spacing).toBe(360); expect(fit.phase).toBe(20)
    expect(fit.trials).toBe(21594)
    expect(fit.medianMass).toBe(239)
    expect(fit.residual).toBe(352)
    expect(fit.gutterOk).toBe(false)
    expect(fit.cutLines.map((c) => `${c.x}:${c.mass}`)).toEqual(['380:0','740:0','1100:0','1460:0','1820:0','2180:352','2540:0'])
    // The same search, a different modulus: the fixture answer is not this one.
    expect(fit.spacing).not.toBe(255)
  })
})

describe('the committed fixture, read from its bytes', () => {
  it('reproduces Phase 1\'s fixture fit (255 / 253) — the same search, another modulus', async () => {
    const { data, info } = await sharp('tests/fixtures/anim/chaser_idle_f1_8dir.png', { limitInputPixels: false }).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
    expect(info.width).toBe(2048); expect(info.height).toBe(246)
    const field = sampleFieldRgb(data, info.width, info.height)
    expect(field).toEqual([253, 5, 250])
    const fit = fitPanelGrid(columnProfile(data, info.width, info.height, field), { cells: 8 })
    expect(fit.spacing).toBe(255); expect(fit.phase).toBe(253)
    expect(fit.trials).toBe(10496)
    expect(fit.medianMass).toBe(167)
    expect(fit.gutterOk).toBe(false)
    expect(fit.cutLines.map((c) => c.x)).toEqual([508, 763, 1018, 1273, 1528, 1783, 2038])
    expect(fit.cutLines.filter((c) => c.mass === 246)).toHaveLength(1)
  })
})

describe('buildStripPrompt', () => {
  const body = { subject: 'a beast', motion: 'a calm idle', frame: 0, frames: 4, dirs: DIRS8, styleText: 'painterly' }
  it('enumerates every cell with its direction, in order', () => {
    const p = buildStripPrompt(body)
    for (let i = 0; i < DIRS8.length; i++) expect(p).toContain(`cell ${i + 1} facing ${DIRS8[i]}`)
    expect(p).toContain('cell 1 facing east'); expect(p).toContain('cell 8 facing north-east')
    expect(DIRS8.map((d, i) => `cell ${i + 1} facing ${d}`).every((s) => p.includes(s))).toBe(true)
  })
  it('pins the background and the four constraints', () => {
    const p = buildStripPrompt(body)
    expect(p).toContain('#FF00FF')
    expect(p).toContain('COMPLETELY INSIDE its own cell with a wide magenta gutter')
    expect(p).toContain('The background is NOT a scene')
    expect(p).toContain('no card, no plaque, no frame, no panel')
    expect(p).toContain('no text, no grid lines, no cell borders, no labels')
    expect(p).toContain('on a perfectly flat pure magenta #FF00FF background')
  })
  it('generates a 4-cell enumeration for dirs4 — no 8-cell sentence survives', () => {
    const p = buildStripPrompt({ ...body, dirs: DIRS4 })
    expect(p).toContain('a flat 1-row x 4-column strip of 4 equal square cells')
    expect(p).toContain('cell 4 facing back')
    expect(p).not.toContain('cell 5 facing')
    expect(p).not.toContain('x 8-column')
  })
  it('inlines the style text and prints the frame 1-based', () => {
    const p = buildStripPrompt({ ...body, styleText: 'STYLE-SENTINEL' })
    expect(p).toContain('STYLE-SENTINEL')
    expect(p).toContain('(animation frame 1 of 4)')
    expect(buildStripPrompt({ ...body, frame: 3 })).toContain('(animation frame 4 of 4)')
  })
  it('rejects a frame outside the state', () => {
    expect(() => buildStripPrompt({ ...body, frame: 4 })).toThrow(/outside/)
    expect(() => buildStripPrompt({ ...body, dirs: [] })).toThrow(/at least one cell/)
  })
})

describe('nothing is imported here (D-21)', () => {
  const source = readFileSync(new URL('../animStrip.ts', import.meta.url), 'utf8')
  const imports = source.match(/^\s*import\b.*$/gm) ?? []
  it('imports nothing at all — no node, no next, no react', () => {
    expect(imports).toEqual([])
    // A regex that matched nothing because the file moved would make the
    // assertion above vacuous.
    expect(source.length).toBeGreaterThan(2000)
    expect(source).toContain('export function fitPanelGrid')
  })
})

describe('the probe record this module was built from', () => {
  const RECORD = '.planning/phases/01-transport-probe/01-PROBE-RECORD.md'
  /** Phase 1's one paid call. The literal below is the drift anchor: if the record's
   * prompt is ever rewritten, this test names the exact value it changed from. */
  const PROBE_PROMPT_SHA = '9d966280493b9530e2271a1775463ea0513d2e50fdedc97d3fcadf92ffcfe8a6'

  it('still holds the prompt the paid call actually sent', () => {
    const record = readFileSync(RECORD, 'utf8')
    // `matchAll` returns an iterator, and this repo's es5 target rejects iterating one (TS2802).
    const fence = /```json\s*([\s\S]*?)```/g
    const blocks: string[] = []
    let m: RegExpExecArray | null
    while ((m = fence.exec(record)) !== null) blocks.push(m[1])
    expect(blocks.length).toBe(1)
    const block = JSON.parse(blocks[0]) as { prompt_sha256?: string; prompt_full?: string }
    expect(block.prompt_sha256).toBe(PROBE_PROMPT_SHA)
    const prompt = block.prompt_full ?? ''
    expect(createHash('sha256').update(prompt, 'utf8').digest('hex')).toBe(PROBE_PROMPT_SHA)
    // `DIRS8.entries()` would need downlevelIteration under this repo's es5 target (TS2802).
    for (let i = 0; i < DIRS8.length; i++) expect(prompt).toContain(`cell ${i + 1} facing ${DIRS8[i]}`)
    expect(prompt).toContain('#FF00FF')
  })
})
