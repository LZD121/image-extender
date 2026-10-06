#!/usr/bin/env node
// scripts/probe-measure.mjs — one strip PNG in, the phase's numbers out.
//
// Usage: node scripts/probe-measure.mjs <strip.png> <N cells> [--json <out>]
//
// What it measures (D-10 ②③④⑤, everything but the call itself):
//   - real pixel dimensions, read from the decoded bytes (never from the request)
//   - the field colour, sampled from the four corners (the model paints a flat
//     magenta field; the corners are the safest sample because the prompt keeps
//     every creature inside its own cell with a gutter)
//   - the panel grid: a column mass profile (how much content each column holds)
//     fitted for (spacing, phase) by SEARCH — a cut is good when it lands on an
//     empty gutter column, so the fit minimises the mass sitting on the cut lines
//   - deltaPct: how far the fitted spacing is from the naive W/N
//   - gutterOk: every cut line sits on a mostly-empty column
//
// Everything except secondsMeasure is a pure function of the input bytes, so two
// runs on one file produce byte-identical JSON once secondsMeasure is dropped —
// that is the determinism contract Phase 2's pure port must preserve.

import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
const require = createRequire(import.meta.url)
const sharp = require('sharp')

const [, , pngPath, nArg] = process.argv
if (!pngPath || !nArg) {
  console.error('usage: node scripts/probe-measure.mjs <strip.png> <N cells>')
  process.exit(2)
}
const N = Number(nArg)
const t0 = process.hrtime.bigint()

const { data, info } = await sharp(pngPath, { limitInputPixels: false })
  .removeAlpha()
  .raw()
  .toBuffer({ resolveWithObject: true })
const W = info.width
const H = info.height
const C = info.channels // 3 after removeAlpha

const at = (x, y) => {
  const i = (y * W + x) * C
  return [data[i], data[i + 1], data[i + 2]]
}

/** Field colour = median of the four corners (each corner sampled 3px in). */
const corners = [at(2, 2), at(W - 3, 2), at(2, H - 3), at(W - 3, H - 3)]
const field = [0, 1, 2].map((c) => {
  const v = corners.map((p) => p[c]).sort((a, b) => a - b)
  return Math.round((v[1] + v[2]) / 2)
})

/** A column's "content" = pixels that differ from the field by more than 60 (sum of channels). */
const DIST = 60
const columnMass = new Int32Array(W)
for (let x = 0; x < W; x++) {
  let m = 0
  for (let y = 0; y < H; y++) {
    const i = (y * W + x) * C
    const d =
      Math.abs(data[i] - field[0]) + Math.abs(data[i + 1] - field[1]) + Math.abs(data[i + 2] - field[2])
    if (d > DIST) m++
  }
  columnMass[x] = m
}

/** Search the grid: cuts at phase + k*spacing must sit on empty columns. */
const uniform = W / N
const sortedMass = Array.from(columnMass).sort((a, b) => a - b)
const medianMass = sortedMass[Math.floor(W / 2)]
let best = { spacing: uniform, phase: 0, cutMass: Infinity, trials: 0 }
for (let s = Math.round(uniform * 0.92); s <= Math.round(uniform * 1.08); s++) {
  for (let p = 0; p < s; p++) {
    let cutMass = 0
    let ok = true
    for (let k = 1; k < N; k++) {
      const x = Math.round(p + k * s)
      if (x <= 0 || x >= W) {
        ok = false
        break
      }
      cutMass += columnMass[x]
    }
    best.trials++
    if (ok && cutMass < best.cutMass) best = { spacing: s, phase: p, cutMass, trials: best.trials }
  }
}
const deltaPct = ((best.spacing - uniform) / uniform) * 100
// A cut line is "safe" when it holds no more than 2% of the busiest content column.
const cutLines = []
let gutterOk = true
for (let k = 1; k < N; k++) {
  const x = Math.round(best.phase + k * best.spacing)
  if (x <= 0 || x >= W) {
    gutterOk = false
    cutLines.push({ x, mass: null })
    continue
  }
  const mass = columnMass[x]
  if (mass > Math.max(1, medianMass * 0.02)) gutterOk = false
  cutLines.push({ x, mass })
}

const secondsMeasure = Number(process.hrtime.bigint() - t0) / 1e9
const out = {
  file: pngPath,
  N,
  width: W,
  height: H,
  aspect: Number((W / H).toFixed(4)),
  field_rgb: field,
  field_hex: '#' + field.map((c) => c.toString(16).padStart(2, '0')).join('').toUpperCase(),
  fitted_pitch: best.spacing,
  phase: best.phase,
  uniform_pitch: Number(uniform.toFixed(3)),
  delta_pct_vs_uniform: Number(deltaPct.toFixed(3)),
  cut_mass: best.cutMass,
  median_column_mass: medianMass,
  gutter_ok: gutterOk,
  cut_lines: cutLines,
  search: { trials: best.trials, span: '±8% of W/N' },
  seconds_measure: Number(secondsMeasure.toFixed(6)),
}
console.log(JSON.stringify(out, null, 2))
