import { describe, expect, it } from 'vitest'
import { messages, type Locale, type TranslateParams } from '@/app/i18n'
import { interpolate } from '@/app/lib/i18n'
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
    expect(translateServerError('2d context unavailable', zh)).toBe('2D 画布不可用')
  })

  it('passes provider passthrough text through untouched', () => {
    const upstream = 'Rate limit exceeded: free-models-per-day'
    expect(translateServerError(upstream, zh)).toBe(upstream)
    expect(translateServerError('Internal Server Error', zh)).toBe('Internal Server Error')
  })

  it('resolves every wire message the app can show, in both locales', () => {
    const samples = [
      // API routes
      'Missing required fields',
      'No message in response',
      'No image generated. The model may not support pure image generation.',
      'Internal server error',
      'OpenRouter API key missing. Add one in Settings.',
      'probe failed',
      // asset library route + path validation
      'invalid JSON body',
      'missing route params',
      'invalid asset path',
      'invalid project',
      'invalid kind',
      'invalid slug',
      'missing meta',
      'missing files',
      'invalid file',
      'invalid project name: Demo!',
      'invalid kind: sprite-sheet',
      'invalid slug: bad name',
      'invalid asset file path: derived/x.png',
      'path resolves outside the asset library root: /etc/passwd',
      'invalid file path: derived/x.png',
      'invalid payload for derived/x.png',
      'file too large: derived/x.png',
      'payload too large',
      'asset library unavailable: ENOENT: no such file or directory',
      'asset not found',
      'file not found',
      'save failed',
      // pixel vendor route
      'description is required',
      'width/height must be integers in 16..400',
      'image_size must be an integer in 32..256',
      'template_id must be one of mannequin, bear',
      'view must be one of low top-down, side',
      'missing x-pixellab-key',
      'invalid character id',
      'invalid url',
      'https only',
      'host evil.example is not a vendor host',
      'upstream 502',
      'unknown op',
      // client-side canvas / loader failures
      '2d context unavailable',
      'Failed to get canvas context',
      'Failed to get rotation canvas context',
      'Failed to load image',
      'Failed to load image for slicing',
      'could not load /demo/tiles/x/meta.json',
      'no figure pixels found',
      'figure 210px above the 120-200 band',
      'figure 18px below the 120-200 band',
      'cropToCell: figure 300x300 does not fit 256x256; change image_size instead of rescaling',
      'meta.json is missing slug/type',
      'not a data URL (expected data:image/png|jpeg|webp;base64,…)',
    ]

    const unresolved: string[] = []
    for (const sample of samples) {
      const resolved = serverErrorKey(sample)
      if (!resolved) {
        unresolved.push(sample)
        continue
      }
      for (const locale of ['en', 'zh'] as const) {
        const rendered = translateServerError(sample, tIn(locale))
        expect(rendered, `${locale}: ${sample}`).not.toMatch(/\{[a-z]+\}/)
        expect(rendered, `${locale}: ${sample}`).not.toBe(resolved.key)
      }
    }
    expect(unresolved).toEqual([])
  })
})
