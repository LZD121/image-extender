import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * LIB-02 payload arithmetic guard (D-48).
 *
 * The library route caps the whole save request, and a run's `raw/` strips would
 * blow through that cap: one 8-direction strip at the size Phase 1 measured is
 * 17,055,535 bytes, so a 16-strip set is ~272.9 MB of image, which becomes
 * ~363.8M base64 characters — past the route's total cap. That is why `raw/`
 * never enters the payload (D-42), and why this is arithmetic rather than a
 * runtime rejection: a runtime check cannot notice the day someone widens the
 * *shape*, but an assertion over the shape's own arithmetic can.
 *
 * The caps are parsed out of the route source rather than copied here. A copy
 * would keep passing after the route's limit changed, which is exactly the drift
 * this guard exists to catch.
 */
const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
const ROUTE_SOURCE = readFileSync(path.join(REPO, 'app/api/library/[[...path]]/route.ts'), 'utf8')

const routeConst = (name: string): number => {
  // One line, expression only: the declaration is arithmetic rather than a bare
  // number (`Math.ceil((40 * 1024 * 1024 * 4) / 3) + 256`), and the line carries
  // a trailing comment that must not be evaluated with it.
  const line = ROUTE_SOURCE.split('\n').find((l) => l.includes(`const ${name} `))
  if (!line) throw new Error(`${name} is no longer declared in the library route — this guard needs re-pointing`)
  const expr = line.slice(line.indexOf('=') + 1).split('//')[0].trim()
  // Arithmetic only: no identifiers beyond `Math.ceil`, no calls.
  if (!/^[0-9A-Za-z_.\s*+/()-]+$/.test(expr)) throw new Error(`${name} is not a plain expression: ${expr}`)
  const value = Number(eval(expr.replace(/_/g, '')))
  if (!Number.isFinite(value) || value <= 0) throw new Error(`${name} parsed to ${value}`)
  return value
}

const MAX_FILE_CHARS = routeConst('MAX_FILE_CHARS')
const MAX_TOTAL_CHARS = routeConst('MAX_TOTAL_CHARS')

/** Phase 1's measurement: one 8-direction strip as the model returns it. */
const RAW_STRIP_BYTES = 17_055_535
/** A 16-strip set: 2 states × 8 directions. */
const STRIPS_IN_A_SET = 16
/** One derived frame, measured in the same phase. */
const DERIVED_FRAME_BYTES = 441_000
/** 16 strips × 8 directions of frames — the whole set, as PNGs. */
const DERIVED_FRAMES = STRIPS_IN_A_SET * 8
const BASE64_EXPANSION = 4 / 3

/** What a file costs the request body once it is a data URL. */
const dataUrlChars = (decodedBytes: number) => Math.ceil(decodedBytes * BASE64_EXPANSION)

describe('payload arithmetic guard (LIB-02)', () => {
  it("parses the route's real caps, so this guard tracks the route", () => {
    // Sanity: the two caps are large, ordered, and distinct. If the route ever
    // stops declaring them as literals the parse above throws instead.
    expect(MAX_FILE_CHARS).toBeGreaterThan(1_000_000)
    expect(MAX_TOTAL_CHARS).toBeGreaterThan(MAX_FILE_CHARS)
  })

  it('cannot carry a set of raw strips', () => {
    const raws = dataUrlChars(RAW_STRIP_BYTES) * STRIPS_IN_A_SET
    expect(raws).toBeGreaterThan(MAX_TOTAL_CHARS)
    // And not by a hair — the shape is off by roughly a third, so no rounding
    // argument rescues it.
    expect(raws / MAX_TOTAL_CHARS).toBeGreaterThan(1.2)
  })

  it('carries the derived frames with room to spare', () => {
    const derived = dataUrlChars(DERIVED_FRAME_BYTES) * DERIVED_FRAMES
    expect(derived).toBeLessThan(MAX_TOTAL_CHARS)
    // The ledger and meta.json are noise next to this, but the set as a whole
    // must stay inside the per-file cap too, or a save would fail one file at a
    // time instead of all at once.
    expect(dataUrlChars(DERIVED_FRAME_BYTES)).toBeLessThan(MAX_FILE_CHARS)
  })
})
