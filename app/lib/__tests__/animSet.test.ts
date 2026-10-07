import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  CELL_MAX, CELL_MIN, MAX_STRIP_WIDTH, AnimSpecError, buildSetJson, durationsMs, frameFile, frameIndex,
  frameNumber, nextPending, parseStripKey, planSize, planStrips, stripFile, stripKey, validateAnimSetSpec,
} from '@/app/lib/animSet'
import type { AnimSetSpec, StripFacts, StripRecord } from '@/app/lib/animSet'
import { DIRS8 } from '@/app/lib/animStrip'

function raw(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    actor: 'chaser',
    subject: 'a hulking armored beast chaser',
    dirs: 'dirs8',
    cell: 512,
    styleText: 'Hand-painted dark-fantasy dungeon art',
    background: 'magenta',
    model: 'teamo-router/gemini-3.1-flash-image',
    out: './out/chaser',
    states: [
      { name: 'idle', motion: 'a calm breathing idle', frames: 4, fps: 4, loop: true },
      { name: 'walk', motion: 'mid-step of a heavy walk', frames: 4, fps: 8, loop: true },
    ],
    ...over,
  }
}
function spec(over: Record<string, unknown> = {}): AnimSetSpec {
  return validateAnimSetSpec(raw(over)).spec
}

describe('validateAnimSetSpec — the hard errors (GEN-07)', () => {
  it('accepts the spec v2 §5.1 shape', () => {
    const { spec: s, warnings } = validateAnimSetSpec(raw())
    expect(warnings).toEqual([])
    expect(s.actor).toBe('chaser'); expect(s.dirs).toBe('dirs8'); expect(s.cell).toBe(512)
    expect(s.states.map((st) => st.name)).toEqual(['idle', 'walk'])
    expect(s.background).toBe('magenta')
  })
  it.each([
    ['inconsistent frame counts', { states: [{ name: 'idle', motion: 'm', frames: 4, fps: 4, loop: true }, { name: 'walk', motion: 'm', frames: 3, fps: 4, loop: true }] }, /same frames/],
    ['an unknown dirs preset', { dirs: 'dirs16' }, /dirs must be one of dirs8, dirs4/],
    ['a free-form direction array', { dirs: ['east'] }, /dirs must be one of dirs8, dirs4/],
    ['cell × dirs over 4096', { cell: 1024 }, /exceeds 4096/],
    ['a cell out of range', { cell: 32 }, /cell must be in \[64, 1024\]/],
    ['empty states', { states: [] }, /non-empty array/],
    ['duplicate state names', { states: [{ name: 'idle', motion: 'm', frames: 1, fps: 1, loop: true }, { name: 'idle', motion: 'm', frames: 1, fps: 1, loop: true }] }, /duplicate state name/],
    ['an illegal actor slug', { actor: 'Chaser' }, /actor must match/],
    ['an illegal state name', { states: [{ name: 'idle 1', motion: 'm', frames: 1, fps: 1, loop: true }] }, /states\[0\]\.name/],
    ['frames = 0', { states: [{ name: 'idle', motion: 'm', frames: 0, fps: 1, loop: true }] }, /frames must be/],
    ['fps = 0', { states: [{ name: 'idle', motion: 'm', frames: 1, fps: 0, loop: true }] }, /fps must be/],
  ])('rejects %s', (_label, over, pattern) => {
    expect(() => validateAnimSetSpec(raw(over))).toThrow(pattern)
  })
  it('carries the offending field name so the CLI can point at it', () => {
    try { validateAnimSetSpec(raw({ cell: 32 })) } catch (err) {
      expect(err).toBeInstanceOf(AnimSpecError)
      expect((err as AnimSpecError).field).toBe('cell')
    }
  })
  it('warns about unknown fields instead of failing (D-17 forward compatibility)', () => {
    const { spec: s, warnings } = validateAnimSetSpec(raw({ futureKnob: 1, states: [{ name: 'idle', motion: 'm', frames: 1, fps: 1, loop: true, anchor: 'x' }] }))
    expect(warnings).toEqual(['unknown field ignored: futureKnob', 'unknown field ignored: states[0].anchor'])
    expect(s.actor).toBe('chaser')
  })
  it('pins the bounds it enforces', () => {
    expect([CELL_MIN, CELL_MAX, MAX_STRIP_WIDTH]).toEqual([64, 1024, 4096])
    // 8 × 512 = 4096 is the largest legal 8-way strip; 8 × 1024 is not legal.
    expect(() => validateAnimSetSpec(raw({ cell: 512 }))).not.toThrow()
    expect(() => validateAnimSetSpec(raw({ cell: 640 }))).toThrow(/exceeds 4096/)
    // dirs4 at 1024 is exactly 4096 and is legal.
    expect(validateAnimSetSpec(raw({ dirs: 'dirs4', cell: 1024 })).spec.cell).toBe(1024)
  })
})

describe('the 1-based ↔ 0-based conversion, in one place (D-15)', () => {
  it('maps both boundary values', () => {
    expect(frameNumber(0)).toBe('f1'); expect(frameNumber(3)).toBe('f4')
    expect(frameIndex('f1')).toBe(0); expect(frameIndex('f4')).toBe(3)
    expect(frameIndex(frameNumber(0))).toBe(0)
    expect(frameIndex(frameNumber(11))).toBe(11)
  })
  it('refuses anything that is not an fN label', () => {
    for (const bad of ['f0', 'F1', 'f', 'f1x', '', 'f01']) expect(() => frameIndex(bad)).toThrow(/not a frame label/)
    expect(() => frameNumber(-1)).toThrow(/non-negative/)
  })
  it('builds the two file names spec v2 §5.3 writes', () => {
    expect(stripFile('idle', 0, 'dirs8')).toBe('raw/idle_f1_8dir.png')
    expect(stripFile('attack', 3, 'dirs8')).toBe('raw/attack_f4_8dir.png')
    expect(stripFile('walk', 0, 'dirs4')).toBe('raw/walk_f1_4dir.png')
    expect(frameFile('idle', 0, 'north-east')).toBe('derived/idle_f1_north-east.png')
    expect(frameFile('walk', 3, 'back')).toBe('derived/walk_f4_back.png')
  })
})

describe('planStrips / planSize (spec v2 §5.2)', () => {
  it('is one entry per (state, frame): Σ states.frames', () => {
    const plan = planStrips(spec())
    expect(plan).toHaveLength(8)
    expect(plan.map((p) => `${p.state}:${p.frame}`)).toEqual(['idle:0','idle:1','idle:2','idle:3','walk:0','walk:1','walk:2','walk:3'])
    expect(plan.map((p) => p.index)).toEqual([0,1,2,3,4,5,6,7])
    expect(plan[0].file).toBe('raw/idle_f1_8dir.png')
    expect(plan[7].file).toBe('raw/walk_f4_8dir.png')
  })
  it('sizes every strip as cell × dirs, exactly', () => {
    expect(planSize(spec())).toEqual({ width: 4096, height: 512, aspect: 8 })
    expect(planSize(spec({ dirs: 'dirs4', cell: 512 }))).toEqual({ width: 2048, height: 512, aspect: 4 })
    expect(planStrips(spec())[0].width).toBe(4096)
  })
  it('gives every strip the 8-cell enumeration, in the preset order', () => {
    for (const strip of planStrips(spec())) {
      expect(strip.prompt).toContain('a flat 1-row x 8-column strip of 8 equal square cells')
      for (let i = 0; i < DIRS8.length; i++) expect(strip.prompt).toContain(`cell ${i + 1} facing ${DIRS8[i]}`)
      expect(strip.prompt).toContain('#FF00FF')
    }
  })
  it('spells the frame 1-based in the prompt but keeps the index 0-based', () => {
    const plan = planStrips(spec())
    expect(plan[0].prompt).toContain('(animation frame 1 of 4)')
    expect(plan[3].prompt).toContain('(animation frame 4 of 4)')
    expect(plan[3].frame).toBe(3)
  })
})

describe('buildSetJson (GEOM-03, D-19)', () => {
  const record: StripRecord[] = [
    { state: 'idle', frame: 0, file: 'raw/idle_f1_8dir.png', ok: true, seconds: 21.4, requested: '4096x512', returned: '2928x352', fitted: { spacing: 360, phase: 20, residualPct: 0.056, gutterOk: false }, field: { hex: '#FC06FA', cast: 244, preset: 'binary' }, steps: { borderTrimmed: 8, isolated: 2 }, prompt: 'P' },
    { state: 'idle', frame: 1, file: 'raw/idle_f2_8dir.png', ok: false, seconds: 0, requested: '4096x512', returned: '', fitted: { spacing: 0, phase: 0, residualPct: 0, gutterOk: false }, field: { hex: '', cast: 0, preset: 'binary' }, steps: {}, prompt: 'P' },
  ]
  it('writes durationsMs as round(1000/fps) per frame', () => {
    expect(durationsMs(4, 4)).toEqual([250, 250, 250, 250])
    expect(durationsMs(8, 4)).toEqual([125, 125, 125, 125])
    expect(durationsMs(3, 2)).toEqual([333, 333])
    expect(durationsMs(7, 1)).toEqual([143])
    expect(() => durationsMs(0, 4)).toThrow(/fps/)
    expect(() => durationsMs(4, 0)).toThrow(/frames/)
  })
  it('shapes set.json as spec v2 §5.3 pins it', () => {
    const set = buildSetJson({ spec: spec(), strips: record, provider: 'magpie' })
    expect(set.schemaVersion).toBe(1); expect(set.kind).toBe('animation-set')
    expect(set.actor).toBe('chaser')
    expect(set.dirs).toEqual({ preset: 'dirs8', order: [...DIRS8] })
    expect(set.cell).toBe(512)
    expect(set.states).toEqual([
      { name: 'idle', frames: 4, fps: 4, durationsMs: [250, 250, 250, 250], loop: true },
      { name: 'walk', frames: 4, fps: 8, durationsMs: [125, 125, 125, 125], loop: true },
    ])
    expect(set.backend).toEqual({ provider: 'magpie', model: 'teamo-router/gemini-3.1-flash-image' })
  })
  it('enumerates one frame row per cell of every strip, naming both files', () => {
    const set = buildSetJson({ spec: spec(), strips: record, provider: 'magpie' })
    expect(set.frames).toHaveLength(16)
    expect(set.frames[0]).toEqual({ state: 'idle', dir: 'east', index: 0, file: 'derived/idle_f1_east.png', strip: 'raw/idle_f1_8dir.png' })
    expect(set.frames[7]).toEqual({ state: 'idle', dir: 'north-east', index: 7, file: 'derived/idle_f1_north-east.png', strip: 'raw/idle_f1_8dir.png' })
    expect(set.frames[15].file).toBe('derived/idle_f2_north-east.png')
    expect(set.frames.every((f) => f.file.startsWith('derived/'))).toBe(true)
  })
  it('counts totals over the ok strips only', () => {
    const set = buildSetJson({ spec: spec(), strips: record, provider: 'magpie' })
    expect(set.totals).toEqual({ calls: 1, cells: 8, seconds: 21.4 })
  })
})

describe('nextPending (GEN-04, D-16)', () => {
  const s = spec()
  const facts = (over: Record<string, Partial<StripFacts>> = {}): Map<string, StripFacts> => {
    const m = new Map<string, StripFacts>()
    for (const strip of planStrips(s)) m.set(stripKey(strip.state, strip.frame), { rawDecodable: true, derivedCount: 8, ...(over[stripKey(strip.state, strip.frame)] ?? {}) })
    return m
  }
  const done = (state: string, frame: number): StripRecord => ({ state, frame, file: stripFile(state, frame, 'dirs8'), ok: true, seconds: 1, requested: '4096x512', returned: '2928x352', fitted: { spacing: 360, phase: 20, residualPct: 0.05, gutterOk: true }, field: { hex: '#FC06FA', cast: 244, preset: 'binary' }, steps: {}, prompt: 'P' })

  it('is everything, when there is no record', () => {
    const r = nextPending(s, [], new Map())
    expect(r.pending).toHaveLength(8); expect(r.done).toBe(0); expect(r.total).toBe(8)
    expect(r.pending.every((p) => p.reason === 'missing')).toBe(true)
    expect(r.duplicates).toEqual([])
  })
  it('is nothing, when every strip is recorded ok with a decodable raw and a full derived set', () => {
    const r = nextPending(s, planStrips(s).map((p) => done(p.state, p.frame)), facts())
    expect(r.pending).toEqual([]); expect(r.done).toBe(8); expect(r.total).toBe(8)
  })
  it('treats a truncated raw as not done — the file exists and is still pending', () => {
    const key = stripKey('idle', 0)
    const r = nextPending(s, [done('idle', 0)], facts({ [key]: { rawDecodable: false } }))
    expect(r.pending.map((p) => `${stripKey(p.state, p.frame)}:${p.reason}`)).toContain('idle:0:raw-unreadable')
  })
  it('treats a short derived set as not done', () => {
    const r = nextPending(s, [done('walk', 3)], facts({ 'walk:3': { derivedCount: 7 } }))
    expect(r.pending.find((p) => stripKey(p.state, p.frame) === 'walk:3')?.reason).toBe('derived-short')
  })
  it('treats a missing fact as not done — silence is not success', () => {
    const m = facts(); m.delete('idle:2')
    const r = nextPending(s, [done('idle', 2)], m)
    expect(r.pending.find((p) => p.index === 2)?.reason).toBe('raw-unreadable')
  })
  it('re-runs a recorded failure', () => {
    const bad: StripRecord = { ...done('idle', 1), ok: false, returned: '2048x512' }
    const r = nextPending(s, [bad], facts())
    expect(r.pending.map((p) => p.reason)).toContain('not-ok')
    expect(r.pending.find((p) => p.frame === 1)?.state).toBe('idle')
  })
  it('honours --redo over a fully done record', () => {
    const rec = planStrips(s).map((p) => done(p.state, p.frame))
    const r = nextPending(s, rec, facts(), { redo: ['walk:2'] })
    expect(r.pending).toHaveLength(1); expect(r.pending[0].reason).toBe('redo')
    expect(stripKey(r.pending[0].state, r.pending[0].frame)).toBe('walk:2')
    expect(r.done).toBe(7)
  })
  it('reports a duplicated (state, frame) instead of silently accepting it', () => {
    // The consumer's ledger already carries 17 rows for 16 strips from an
    // append that never merged. The record is accepted, the duplicate is named.
    const rec = [...planStrips(s).map((p) => done(p.state, p.frame)), done('idle', 0)]
    const r = nextPending(s, rec, facts())
    expect(r.duplicates).toEqual(['idle:0'])
    expect(r.pending).toEqual([])
    expect(r.done).toBe(8)
  })
  it('keys and parses state:frame in one spelling', () => {
    expect(stripKey('idle', 0)).toBe('idle:0')
    expect(parseStripKey('walk:3')).toEqual({ state: 'walk', frame: 3 })
    expect(parseStripKey(stripKey('attack', 12))).toEqual({ state: 'attack', frame: 12 })
    for (const bad of ['idle', ':0', 'idle:-1', 'idle:x']) expect(() => parseStripKey(bad)).toThrow(/not a state:frame key/)
  })
})

describe('imports only animStrip (D-21)', () => {
  const source = readFileSync(new URL('../animSet.ts', import.meta.url), 'utf8')
  const specifiers = Array.from(source.matchAll(/from '([^']+)'/g), (m) => m[1])
  it('is pure: one internal import, nothing from a runtime', () => {
    expect(specifiers).toEqual(['@/app/lib/animStrip'])
    expect(source).not.toMatch(/\brequire\(|process\.|globalThis\./)
    // Same vacuity guard: the scan has to be looking at the real module.
    expect(source.length).toBeGreaterThan(2000)
    expect(source).toContain('export function nextPending')
  })
})
