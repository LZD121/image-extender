import { describe, expect, it } from 'vitest'
import { DEFAULT_MODEL, getModelConfig, skipsArtDirectorReview } from '@/app/lib/models'

describe('getModelConfig', () => {
  it('reads the curated OpenRouter table', () => {
    expect(getModelConfig(DEFAULT_MODEL).value).toBe(DEFAULT_MODEL)
    expect(getModelConfig(DEFAULT_MODEL).maxAttempts).toBe(3)
  })

  it('times a gateway-discovered model by its own heuristics', () => {
    // Regression: an unknown id used to fall back to the default model's config,
    // which asked a task-API image model for three best-of-N candidates.
    const apimart = getModelConfig('gpt-image-2-official')
    expect(apimart.maxAttempts).toBe(1)
    expect(apimart.approxSecondsPerCall).toBe(30)

    const magpie = getModelConfig('teamo-router/gemini-3.1-flash-image')
    expect(magpie.maxAttempts).toBe(3)
    expect(magpie.approxSecondsPerCall).toBe(20)
  })

  it('prefers a discovered option when one is supplied', () => {
    const extra = [{ value: 'x/y', label: 'y', maxAttempts: 1, approxSecondsPerCall: 99 }]
    expect(getModelConfig('x/y', extra).approxSecondsPerCall).toBe(99)
  })
})

describe('skipsArtDirectorReview', () => {
  it('skips the review on the slow image models, wherever they are hosted', () => {
    expect(skipsArtDirectorReview('openai/gpt-5.4-image-2')).toBe(true)
    expect(skipsArtDirectorReview('gpt-image-2-official')).toBe(true)
    expect(skipsArtDirectorReview('teamo-router/gpt-image-2')).toBe(true)
    expect(skipsArtDirectorReview('google/gemini-3.1-flash-image-preview')).toBe(false)
  })
})
