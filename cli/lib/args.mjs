/**
 * Argument parsing and the result envelope — the CLI's only two contracts.
 *
 * Commands declare `options` in `parseArgs` shape; the registry parses with the
 * stdlib's `parseArgs` (strict, so a typo'd flag is a usage error, never a
 * silently ignored argument). Everything a command emits goes through one of
 * the two envelope shapes, so an agent can rely on `ok` alone.
 */
import { parseArgs } from 'node:util'

/** Exit code for "you called this wrong" — distinct from a runtime failure. */
export const USAGE_EXIT = 2

export class UsageError extends Error {
  constructor(message, usage) {
    super(usage ? `${message}\n\n${usage}` : message)
    this.name = 'UsageError'
    this.usage = usage
  }
}

export class CliError extends Error {
  constructor(code, message, detail) {
    super(message)
    this.name = 'CliError'
    this.code = code
    this.detail = detail
  }
}

/**
 * Parse one command's argv. `spec.options` is a `parseArgs` options object;
 * positionals are allowed. Anything the command cannot use is a usage error.
 */
export function parseCommand(argv, spec) {
  let parsed
  try {
    parsed = parseArgs({ args: argv, options: spec.options || {}, allowPositionals: true, strict: true })
  } catch (err) {
    throw new UsageError(err.message, spec.usage)
  }
  return { values: parsed.values, positionals: parsed.positionals }
}

/** Positional access with a usage error instead of `undefined` leaking through. */
export function positional(positionals, index, label, spec) {
  const value = positionals[index]
  if (value === undefined) throw new UsageError(`missing <${label}>`, spec.usage)
  return value
}

/**
 * Numeric flag coercion; a non-number is a usage error, not NaN downstream.
 * `min` guards the values the app's pixel code would loop forever on (a cell
 * size of 0, a zero-column grid).
 */
export function numberFlag(values, key, fallback, spec, min) {
  const raw = values[key]
  if (raw === undefined || raw === '') return fallback
  const n = Number(raw)
  if (!Number.isFinite(n)) throw new UsageError(`--${key} must be a number, got "${raw}"`, spec.usage)
  if (min !== undefined && n < min) {
    throw new UsageError(`--${key} must be >= ${min}, got "${raw}"`, spec.usage)
  }
  return n
}

/** One-of flag coercion (enums the app itself defines). */
export function enumFlag(values, key, allowed, fallback, spec) {
  const raw = values[key]
  if (raw === undefined) return fallback
  if (!allowed.includes(raw)) {
    throw new UsageError(`--${key} must be one of ${allowed.join('|')}, got "${raw}"`, spec.usage)
  }
  return raw
}

export function okEnvelope(payload) {
  return { ok: true, ...(payload || {}) }
}

export function errorEnvelope(err) {
  if (err instanceof UsageError) {
    return { ok: false, error: { code: 'usage', message: err.message }, exit: USAGE_EXIT }
  }
  const code = err && err.code ? String(err.code) : 'error'
  const detail = err && err.detail !== undefined ? err.detail : undefined
  return {
    ok: false,
    error: { code, message: err && err.message ? err.message : String(err), ...(detail !== undefined ? { detail } : {}) },
    exit: 1,
  }
}
