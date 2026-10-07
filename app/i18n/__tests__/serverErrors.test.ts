import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { messages, type Locale, type TranslateParams } from '@/app/i18n'
import { interpolate } from '@/app/lib/i18n'
import { APP_ERROR_MESSAGES, type AppErrorCode } from '@/app/lib/appErrors'
import { serverErrorKey, translateServerError } from '@/app/i18n/serverErrors'

/**
 * The route/canvas messages the client shows come from the server or from
 * `app/utils/*` as English text; `translateServerError` is the only thing that
 * turns them into the active language. Verify the shapes it must handle —
 * exact match, parameterised pattern, and passthrough — in both locales.
 */

const tIn = (locale: Locale) => (key: string, params?: TranslateParams, fallback?: string) =>
  interpolate(messages[locale][key] ?? fallback ?? key, params)

const zh = tIn('zh')
const en = tIn('en')

/**
 * Every quoted string in the app's own source, so a message in the table can be
 * checked against the code that is supposed to write it. Skips the table itself
 * and everything under `app/i18n/` — a translation is not a producer.
 */
function readSources(dirs: string[], skip: string[]): string {
  const root = fileURLToPath(new URL('../../..', import.meta.url))
  const chunks: string[] = []
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name)
      const rel = path.relative(root, full)
      if (skip.some((s) => rel.startsWith(s))) continue
      if (entry.isDirectory()) walk(full)
      else if (/\.(ts|tsx|mjs)$/.test(entry.name) && !rel.includes('__tests__')) {
        chunks.push(readFileSync(full, 'utf8'))
      }
    }
  }
  for (const dir of dirs) walk(path.join(root, dir))
  return chunks.join('\n')
}

describe('translateServerError', () => {
  it('translates an exact app message', () => {
    expect(translateServerError('Missing required fields', zh)).toBe('缺少必填字段')
  })

  it('renders English byte-identically', () => {
    expect(en('Missing required fields')).toBe('Missing required fields')
    expect(translateServerError('Missing required fields', en)).toBe('Missing required fields')
    expect(
      translateServerError(
        'The model responded without an image. It may not support image extension yet.',
        en
      )
    ).toBe('The model responded without an image. It may not support image extension yet.')
  })

  it('fills parameters of a patterned message', () => {
    expect(translateServerError('file too large: derived/body.png', zh)).toBe(
      '文件过大：derived/body.png'
    )
    expect(translateServerError('upstream 502', zh)).toBe('上游返回 502')
    expect(translateServerError('figure 210px above the 120-200 band', zh)).toBe(
      '图形超出 120-200 区间 210px（偏高）'
    )
  })

  it('translates the provider-key message without losing the provider name', () => {
    const result = translateServerError('Magpie gateway API key missing. Add one in Settings.', zh)
    expect(result).toContain('Magpie gateway')
    expect(result).toContain('API 密钥缺失')
  })

  it('translates the client-side canvas failures that reach the same toast', () => {
    expect(translateServerError('Failed to load image for slicing', zh)).toBe('用于切分的图像加载失败')
    expect(translateServerError('Failed to load image', zh)).not.toBe('Failed to load image')
  })

  it('passes provider passthrough text through untouched', () => {
    const upstream = 'Rate limit exceeded: free-models-per-day'
    expect(translateServerError(upstream, zh)).toBe(upstream)
    expect(translateServerError('Internal Server Error', zh)).toBe('Internal Server Error')
  })

  it('resolves every message the table names, and renders it in both locales', () => {
    for (const code of Object.keys(APP_ERROR_MESSAGES) as AppErrorCode[]) {
      const message = APP_ERROR_MESSAGES[code]
      expect(serverErrorKey(message), `${code} is not mapped`).toBeTruthy()
      const key = serverErrorKey(message)!.key
      // The library route, the pixel relay and the probe phrase their errors as
      // terse lowercase codes, and the registry renders those as sentences.
      // Everything else is declared in sentence case and has to match the
      // registry byte-for-byte — that text is what an English user reads.
      if (message.charAt(0) !== message.charAt(0).toLowerCase()) {
        expect(messages.en[key], `${code}: English drifted from the message`).toBe(message)
      }
      for (const locale of ['en', 'zh'] as const) {
        const rendered = translateServerError(message, tIn(locale))
        expect(rendered, `${locale}: ${code}`).not.toMatch(/\{[a-z]+\}/)
        expect(rendered, `${locale}: ${code}`).not.toBe(key)
      }
    }
  })

  it('names a producer in the source for every message in the table', () => {
    const sources = readSources(['app', 'cli'], ['app/lib/appErrors.ts', 'app/i18n/'])
    const orphans = (Object.keys(APP_ERROR_MESSAGES) as AppErrorCode[]).filter(
      (code) => !sources.includes(`'${APP_ERROR_MESSAGES[code]}'`)
    )
    expect(orphans).toEqual([])
  })

  it('fills the parameters of the patterned messages', () => {
    const samples = [
      'file too large: derived/body.png',
      'upstream 502',
      'figure 210px above the 120-200 band',
      'missing x-pixellab-key',
      'host evil.example is not a vendor host',
      'could not load /demo/tiles/x/meta.json',
      'invalid project name: Demo!',
      'path resolves outside the asset library root: /etc/passwd',
      'asset library unavailable: ENOENT: no such file or directory',
    ]
    for (const sample of samples) {
      expect(serverErrorKey(sample), sample).toBeTruthy()
      for (const locale of ['en', 'zh'] as const) {
        const rendered = translateServerError(sample, tIn(locale))
        expect(rendered, `${locale}: ${sample}`).not.toMatch(/\{[a-z]+\}/)
      }
    }
  })
})
