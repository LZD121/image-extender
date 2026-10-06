/**
 * The two CLI contracts an agent depends on: argument parsing (a typo is a
 * usage error, never a silently ignored flag) and the result envelope
 * (`ok` is the only thing a caller needs to branch on).
 */
import { describe, expect, it } from 'vitest'
import {
  CliError,
  USAGE_EXIT,
  UsageError,
  enumFlag,
  errorEnvelope,
  numberFlag,
  okEnvelope,
  parseCommand,
  positional,
} from '../args.mjs'

const spec = {
  usage: 'ie demo <in> [--cols N] [--axis both|h]',
  options: { cols: { type: 'string' }, axis: { type: 'string' }, loud: { type: 'boolean' } },
}

describe('parseCommand', () => {
  it('splits positionals from flags, coercing booleans', () => {
    const { values, positionals } = parseCommand(['a.png', '--cols', '4', '--loud'], spec)
    expect(positionals).toEqual(['a.png'])
    expect(values).toEqual({ cols: '4', loud: true })
  })

  it('rejects an unknown flag with the usage line attached', () => {
    expect(() => parseCommand(['a.png', '--nope'], spec)).toThrow(UsageError)
    try {
      parseCommand(['a.png', '--nope'], spec)
    } catch (err) {
      expect(err.message).toMatch(/--nope/)
      expect(err.message).toContain(spec.usage)
    }
  })

  it('rejects a flag missing its value', () => {
    expect(() => parseCommand(['--cols'], spec)).toThrow(UsageError)
  })
})

describe('flag coercion', () => {
  it('names the offending flag for a non-number', () => {
    expect(() => numberFlag({ cols: 'four' }, 'cols', 1, spec)).toThrow(/--cols must be a number/)
  })

  it('falls back when the flag is absent, and enforces the minimum', () => {
    expect(numberFlag({}, 'cols', 7, spec)).toBe(7)
    expect(numberFlag({ cols: '9' }, 'cols', 7, spec)).toBe(9)
    expect(() => numberFlag({ cols: '0' }, 'cols', 7, spec, 1)).toThrow(/--cols must be >= 1/)
  })

  it('only accepts values the app itself defines', () => {
    expect(enumFlag({}, 'axis', ['both', 'h'], 'both', spec)).toBe('both')
    expect(enumFlag({ axis: 'h' }, 'axis', ['both', 'h'], 'both', spec)).toBe('h')
    expect(() => enumFlag({ axis: 'diagonal' }, 'axis', ['both', 'h'], 'both', spec)).toThrow(/--axis must be one of both\|h/)
  })

  it('reports a missing positional by name', () => {
    expect(positional(['a.png'], 0, 'in', spec)).toBe('a.png')
    expect(() => positional([], 0, 'in', spec)).toThrow(/missing <in>/)
  })
})

describe('envelopes', () => {
  it('wraps success under ok:true', () => {
    expect(okEnvelope({ written: ['a.png'] })).toEqual({ ok: true, written: ['a.png'] })
  })

  it('maps a usage error to exit 2 and code "usage"', () => {
    const envelope = errorEnvelope(new UsageError('missing <in>', spec.usage))
    expect(envelope.exit).toBe(USAGE_EXIT)
    expect(envelope.ok).toBe(false)
    expect(envelope.error.code).toBe('usage')
  })

  it('carries a typed code and detail for a runtime failure', () => {
    const envelope = errorEnvelope(new CliError('EEXISTS', 'asset already exists', { slug: 'smoke' }))
    expect(envelope).toMatchObject({
      ok: false,
      exit: 1,
      error: { code: 'EEXISTS', message: 'asset already exists', detail: { slug: 'smoke' } },
    })
  })

  it('still answers for a plain Error', () => {
    expect(errorEnvelope(new Error('boom'))).toMatchObject({ ok: false, exit: 1, error: { code: 'error', message: 'boom' } })
  })
})
