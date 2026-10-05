import { describe, expect, it } from 'vitest'
import { styleDirective } from '@/app/lib/stylePrompt'

describe('styleDirective', () => {
  it('returns an empty string when no style is selected', () => {
    expect(styleDirective(undefined)).toBe('')
    expect(styleDirective('')).toBe('')
    expect(styleDirective('none')).toBe('')
  })

  it('ignores an unknown style key rather than inventing a directive', () => {
    expect(styleDirective('not-a-real-style')).toBe('')
  })

  it('leads with the style so a long structural prompt cannot bury it', () => {
    const d = styleDirective('pixel-art')
    expect(d.startsWith('RENDER STYLE')).toBe(true)
    expect(d.endsWith('\n\n')).toBe(true)
  })

  it('spells out the negatives that make pixel art read as pixel art', () => {
    const d = styleDirective('pixel-art').toLowerCase()
    for (const term of ['no anti-aliasing', 'no gradients', 'no soft shading']) {
      expect(d, term).toContain(term)
    }
    expect(d).toContain('limited palette')
  })

  it('spells out the negatives that make low-poly read as low-poly', () => {
    const d = styleDirective('low-poly').toLowerCase()
    expect(d).toContain('flat')
    expect(d).toContain('no texture detail')
    expect(d).toContain('no gradients')
  })

  it('covers every style the UI offers a description for', () => {
    expect(styleDirective('cinematic')).not.toBe('')
    expect(styleDirective('watercolor')).not.toBe('')
    expect(styleDirective('anime')).not.toBe('')
  })
})
