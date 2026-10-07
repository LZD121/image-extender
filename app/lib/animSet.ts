// app/lib/animSet.ts
/**
 * The animation-set contract: spec validation, the strip plan, `set.json`, and
 * "what is left to do".
 *
 * Why one module: a set is a *contract* — the spec that asks for it, the plan it
 * expands into, the file the runner writes and the record that says which parts
 * are already done are four views of one shape. The CLI (Phase 4) and the UI
 * (Phase 6) both read them; a second copy of "which file holds which frame" is
 * the class of bug `app/lib/chromaPresets.ts` records paying for once already.
 *
 * Pure. Two consequences worth naming:
 *  - The resume decision takes the runner's *measured facts* as an argument and
 *    never looks at a filesystem, so "a half-written PNG counts as done" cannot
 *    happen by omission — it has to be passed in as `rawDecodable: false`.
 *  - The 1-based filename ↔ 0-based index conversion lives in exactly one place
 *    (`frameNumber`/`frameIndex` below). The consumer's convention is 1-based
 *    (`idle_f1_8dir.png`, ledger `frame: 1`), the plan and `set.json` are
 *    0-based, and every name in this module is built by those two functions.
 */

import {
  DIRS_PRESETS,
  buildStripPrompt,
  dirsForPreset,
  isDirsPreset,
  stripSize,
  type Dir,
  type DirsPreset,
} from '@/app/lib/animStrip'

// ─────────── the spec (spec v2 §5.1) ───────────

export type AnimStateSpec = {
  name: string
  motion: string
  frames: number
  fps: number
  loop: boolean
}

export type AnimSetSpec = {
  /** Library-legal slug: `[a-z0-9][a-z0-9-]{0,63}`. */
  actor: string
  subject: string
  /** A named ordered preset — the order is the engine's row order. */
  dirs: DirsPreset
  states: AnimStateSpec[]
  cell: number
  styleText: string
  background: 'magenta'
  model: string
  out: string
}

/** Cell edge bounds (spec v2 §5.1). */
export const CELL_MIN = 64
export const CELL_MAX = 1024
/** The widest canvas the chat gateways take: `cell × dirs` must not exceed it (spec v2 §5.1). */
export const MAX_STRIP_WIDTH = 4096

const ACTOR_RE = /^[a-z0-9][a-z0-9-]{0,63}$/
const STATE_RE = /^[a-z0-9][a-z0-9-]{0,31}$/

/** Every field the spec may carry. Anything else is a warning, not an error (D-17). */
const SPEC_KEYS = ['actor', 'subject', 'dirs', 'states', 'cell', 'styleText', 'background', 'model', 'out'] as const
const STATE_KEYS = ['name', 'motion', 'frames', 'fps', 'loop'] as const

/**
 * A spec that cannot be run. `field` names the offending key, so the CLI can
 * point at it rather than print a sentence.
 *
 * Written out rather than a TS parameter property on purpose: these modules are
 * imported directly by `node --experimental-strip-types` in the plans' checks,
 * and strip-only mode rejects parameter properties.
 */
export class AnimSpecError extends Error {
  readonly field: string
  constructor(message: string, field: string) {
    super(message)
    this.name = 'AnimSpecError'
    this.field = field
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function requireString(raw: Record<string, unknown>, field: string): string {
  const value = raw[field]
  if (typeof value !== 'string' || value.trim() === '') {
    throw new AnimSpecError(`${field} must be a non-empty string`, field)
  }
  return value
}

function requireInteger(raw: Record<string, unknown>, field: string): number {
  const value = raw[field]
  if (!Number.isInteger(value)) throw new AnimSpecError(`${field} must be an integer`, field)
  return value as number
}

function requireBoolean(raw: Record<string, unknown>, field: string): boolean {
  const value = raw[field]
  if (typeof value !== 'boolean') throw new AnimSpecError(`${field} must be a boolean`, field)
  return value
}

/**
 * Validates an `AnimSetSpec`. Hard errors throw `AnimSpecError` and therefore
 * happen before any call is made (D-17); fields this version does not know are
 * returned as warnings so a spec written for a later version still loads.
 */
export function validateAnimSetSpec(raw: unknown): { spec: AnimSetSpec; warnings: string[] } {
  if (!isRecord(raw)) throw new AnimSpecError('spec must be an object', 'spec')
  const warnings: string[] = []
  for (const key of Object.keys(raw)) {
    if (!(SPEC_KEYS as readonly string[]).includes(key)) warnings.push(`unknown field ignored: ${key}`)
  }

  const actor = requireString(raw, 'actor')
  if (!ACTOR_RE.test(actor)) {
    throw new AnimSpecError(`actor must match ${ACTOR_RE} (the library's FILE_RE), got ${JSON.stringify(actor)}`, 'actor')
  }

  const subject = requireString(raw, 'subject')
  const styleText = requireString(raw, 'styleText')
  const model = requireString(raw, 'model')
  const out = requireString(raw, 'out')

  const dirs = raw.dirs
  if (!isDirsPreset(dirs)) {
    throw new AnimSpecError(
      `dirs must be one of ${DIRS_PRESETS.join(', ')}, got ${JSON.stringify(dirs)} — a free-form array has no defined order, and the order IS the contract`,
      'dirs'
    )
  }
  const dirCount = dirsForPreset(dirs).length

  const background = raw.background
  if (background !== 'magenta') {
    throw new AnimSpecError(`background must be "magenta", got ${JSON.stringify(background)}`, 'background')
  }

  const cell = requireInteger(raw, 'cell')
  if (cell < CELL_MIN || cell > CELL_MAX) {
    throw new AnimSpecError(`cell must be in [${CELL_MIN}, ${CELL_MAX}], got ${cell}`, 'cell')
  }
  if (cell * dirCount > MAX_STRIP_WIDTH) {
    throw new AnimSpecError(
      `cell × dirs = ${cell * dirCount} exceeds ${MAX_STRIP_WIDTH}; shrink the cell rather than let the gateway silently downscale it`,
      'cell'
    )
  }

  const rawStates = raw.states
  if (!Array.isArray(rawStates) || rawStates.length === 0) {
    throw new AnimSpecError('states must be a non-empty array', 'states')
  }
  const names = new Set<string>()
  let frames: number | null = null
  const states: AnimStateSpec[] = rawStates.map((entry, index) => {
    const at = `states[${index}]`
    if (!isRecord(entry)) throw new AnimSpecError(`${at} must be an object`, 'states')
    for (const key of Object.keys(entry)) {
      if (!(STATE_KEYS as readonly string[]).includes(key)) warnings.push(`unknown field ignored: ${at}.${key}`)
    }
    const name = requireString(entry, 'name')
    if (!STATE_RE.test(name)) throw new AnimSpecError(`${at}.name must match ${STATE_RE}, got ${JSON.stringify(name)}`, 'states')
    if (names.has(name)) throw new AnimSpecError(`duplicate state name: ${name}`, 'states')
    names.add(name)

    const motion = requireString(entry, 'motion')
    const stateFrames = requireInteger(entry, 'frames')
    if (stateFrames < 1) throw new AnimSpecError(`${at}.frames must be ≥ 1, got ${stateFrames}`, 'frames')
    // The consumer addresses frames as `frame = row * FRAMES + col` (a ruled
    // grid); that only holds when every state is the same width.
    if (frames === null) frames = stateFrames
    else if (stateFrames !== frames) {
      throw new AnimSpecError(
        `every state must have the same frames (spec v2 §5.1): ${name} has ${stateFrames}, earlier states have ${frames}`,
        'states'
      )
    }

    const fps = requireInteger(entry, 'fps')
    if (fps < 1) throw new AnimSpecError(`${at}.fps must be ≥ 1, got ${fps}`, 'fps')
    return { name, motion, frames: stateFrames, fps, loop: requireBoolean(entry, 'loop') }
  })

  return {
    spec: { actor, subject, dirs, states, cell, styleText, background: 'magenta', model, out },
    warnings,
  }
}

// ─────────── naming: the one conversion ───────────

/**
 * The single place the 1-based filename meets the 0-based index. Frame files
 * are `f1..fN` because a human reads them and the consumer's ledger is 1-based;
 * the plan and `set.json` are 0-based because the code indexes arrays. Every
 * name in this module is built through this pair.
 */
export function frameNumber(frame: number): string {
  if (!Number.isInteger(frame) || frame < 0) throw new Error(`frame index must be a non-negative integer, got ${frame}`)
  return `f${frame + 1}`
}

/** The inverse of `frameNumber`; `f1…fN` back to `0…N-1`. */
export function frameIndex(label: string): number {
  const match = /^f([1-9][0-9]*)$/.exec(label)
  if (!match) throw new Error(`not a frame label: ${JSON.stringify(label)}`)
  return Number(match[1]) - 1
}

const dirLabel = (dirs: DirsPreset): string => (dirs === 'dirs4' ? '4dir' : '8dir')

/** `raw/<state>_f<N>_8dir.png` — the model's untouched reply (spec v2 §5.3). */
export function stripFile(state: string, frame: number, dirs: DirsPreset): string {
  return `raw/${state}_${frameNumber(frame)}_${dirLabel(dirs)}.png`
}

/** `derived/<state>_f<N>_<dir>.png` — one file per cell (spec v2 §5.3). */
export function frameFile(state: string, frame: number, dir: Dir): string {
  return `derived/${state}_${frameNumber(frame)}_${dir}.png`
}

// ─────────── the plan (spec v2 §5.2) ───────────

export type StripPlan = {
  state: string
  /** 0-based. */
  frame: number
  /** Position in the plan, 0-based — `Σ` over the states' frame counts. */
  index: number
  prompt: string
  width: number
  height: number
  file: string
}

/** One plan entry per `(state, frame)`; count = `Σ states.frames` (spec v2 §5.2). */
export function planStrips(spec: AnimSetSpec): StripPlan[] {
  const dirs = dirsForPreset(spec.dirs)
  const size = stripSize(spec.cell, dirs.length)
  const plan: StripPlan[] = []
  for (const state of spec.states) {
    for (let frame = 0; frame < state.frames; frame++) {
      plan.push({
        state: state.name,
        frame,
        index: plan.length,
        prompt: buildStripPrompt({
          subject: spec.subject,
          motion: state.motion,
          frame,
          frames: state.frames,
          dirs,
          styleText: spec.styleText,
        }),
        width: size.width,
        height: size.height,
        file: stripFile(state.name, frame, spec.dirs),
      })
    }
  }
  return plan
}

/** `stripSize` for the whole spec: `cell × dirs` wide, `cell` tall (spec v2 §5.2). */
export function planSize(spec: AnimSetSpec): { width: number; height: number; aspect: number } {
  return stripSize(spec.cell, dirsForPreset(spec.dirs).length)
}

// ─────────── the record (spec v2 §5.3) ───────────

export type StripRecord = {
  state: string
  frame: number
  file: string
  ok: boolean
  seconds: number
  /** `"WxH"` as requested; never asserted to equal `returned` (R1 — 40/40 differ). */
  requested: string
  /** `"WxH"` read back from the bytes on disk. */
  returned: string
  fitted: { spacing: number; phase: number; residualPct: number; gutterOk: boolean }
  field: { hex: string; cast: number; preset: string }
  steps: Record<string, number>
  prompt: string
}

export type SetJsonStrip = {
  state: string
  frame: number
  file: string
  ok: boolean
  seconds: number
  requested: string
  returned: string
  fitted: StripRecord['fitted']
  field: StripRecord['field']
  steps: StripRecord['steps']
  prompt: string
}

export type SetJsonFrame = {
  state: string
  dir: Dir
  index: number
  file: string
  strip: string
}

export type SetJson = {
  schemaVersion: 1
  kind: 'animation-set'
  actor: string
  dirs: { preset: DirsPreset; order: Dir[] }
  cell: number
  states: { name: string; frames: number; fps: number; durationsMs: number[]; loop: boolean }[]
  strips: SetJsonStrip[]
  frames: SetJsonFrame[]
  backend: { provider: string; model: string }
  totals: { calls: number; cells: number; seconds: number }
}

/**
 * One duration per frame, each `round(1000 / fps)` ms (spec v2 §10, D-19).
 *
 * A per-frame array rather than a single number because that is the shape
 * spec v2 §5.3 writes down (`frames: 4, fps: 4, durationsMs: [250,250,250,250]`)
 * and the shape an engine adapter wants: the frame count is the authority on
 * how long the array is, so a spec whose `frames` and durations disagree cannot
 * be expressed.
 */
export function durationsMs(fps: number, frames: number): number[] {
  if (!Number.isInteger(fps) || fps < 1) throw new Error(`fps must be a positive integer, got ${fps}`)
  if (!Number.isInteger(frames) || frames < 1) throw new Error(`frames must be a positive integer, got ${frames}`)
  return new Array(frames).fill(Math.round(1000 / fps))
}

export function buildSetJson(args: {
  spec: AnimSetSpec
  strips: StripRecord[]
  provider: string
}): SetJson {
  const { spec, strips, provider } = args
  const dirs = dirsForPreset(spec.dirs)
  const frames: SetJsonFrame[] = []
  for (const strip of strips) {
    for (let cell = 0; cell < dirs.length; cell++) {
      frames.push({
        state: strip.state,
        dir: dirs[cell],
        index: cell,
        file: frameFile(strip.state, strip.frame, dirs[cell]),
        strip: strip.file,
      })
    }
  }
  const okStrips = strips.filter((s) => s.ok)
  return {
    schemaVersion: 1,
    kind: 'animation-set',
    actor: spec.actor,
    dirs: { preset: spec.dirs, order: dirs.slice() },
    cell: spec.cell,
    states: spec.states.map((state) => ({
      name: state.name,
      frames: state.frames,
      fps: state.fps,
      durationsMs: durationsMs(state.fps, state.frames),
      loop: state.loop,
    })),
    strips: strips.map((strip) => ({ ...strip })),
    frames,
    backend: { provider, model: spec.model },
    totals: {
      calls: okStrips.length,
      cells: okStrips.length * dirs.length,
      seconds: Number(okStrips.reduce((sum, s) => sum + s.seconds, 0).toFixed(3)),
    },
  }
}

// ─────────── resume (spec v2 §8, D-16) ───────────

/** What the runner measured on disk, passed in — never inspected here. */
export type StripFacts = {
  /** The raw PNG decodes as an image. A truncated file is false. */
  rawDecodable: boolean
  /** How many `derived/<state>_f<N>_<dir>.png` files exist for this strip. */
  derivedCount: number
}

export type PendingReason = 'missing' | 'not-ok' | 'raw-unreadable' | 'derived-short' | 'redo'

export type PendingStrip = StripPlan & { reason: PendingReason }

export type PendingResult = {
  pending: PendingStrip[]
  done: number
  total: number
  /** `state:frame` of record entries that appear more than once. Phase 4 asserts this is empty. */
  duplicates: string[]
}

/** The canonical key for `(state, frame)` — one spelling, used by the record and by `--redo`. */
export function stripKey(state: string, frame: number): string {
  return `${state}:${frame}`
}

/** Parses `state:frame` (the `--redo` spelling) back into its two parts. */
export function parseStripKey(key: string): { state: string; frame: number } {
  const at = key.lastIndexOf(':')
  const state = key.slice(0, at)
  const frame = Number(key.slice(at + 1))
  if (at < 1 || !Number.isInteger(frame) || frame < 0) throw new Error(`not a state:frame key: ${JSON.stringify(key)}`)
  return { state, frame }
}

/**
 * What is still to do. Completion comes from the *record* plus the runner's
 * facts — never from "the file exists": `ok:true` with a truncated raw or a
 * short `derived/` set is still pending (R7: the consumer's ledger already
 * carries 17 rows for 16 strips from exactly that mistake).
 */
export function nextPending(
  spec: AnimSetSpec,
  record: readonly StripRecord[],
  facts: ReadonlyMap<string, StripFacts>,
  opts: { redo?: readonly string[] } = {}
): PendingResult {
  const dirCount = dirsForPreset(spec.dirs).length
  const byKey = new Map<string, StripRecord>()
  const duplicates: string[] = []
  for (const entry of record) {
    const key = stripKey(entry.state, entry.frame)
    if (byKey.has(key) && !duplicates.includes(key)) duplicates.push(key)
    byKey.set(key, entry)
  }
  const redo = new Set(opts.redo ?? [])

  const plan = planStrips(spec)
  const pending: PendingStrip[] = []
  for (const item of plan) {
    const key = stripKey(item.state, item.frame)
    if (redo.has(key)) {
      pending.push({ ...item, reason: 'redo' })
      continue
    }
    const entry = byKey.get(key)
    if (!entry) {
      pending.push({ ...item, reason: 'missing' })
      continue
    }
    if (!entry.ok) {
      pending.push({ ...item, reason: 'not-ok' })
      continue
    }
    const fact = facts.get(key)
    if (!fact || !fact.rawDecodable) {
      pending.push({ ...item, reason: 'raw-unreadable' })
      continue
    }
    if (fact.derivedCount < dirCount) {
      pending.push({ ...item, reason: 'derived-short' })
      continue
    }
  }

  return { pending, done: plan.length - pending.length, total: plan.length, duplicates }
}
