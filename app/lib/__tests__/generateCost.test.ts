import { describe, expect, it } from 'vitest'
import { extractCost } from '@/app/lib/generateCost'

describe('extractCost', () => {
  it('reads OpenRouter usage cost when present', () => {
    expect(extractCost({ usage: { cost: 0.0312 } })).toEqual({ usd: 0.0312, source: 'openrouter' })
  })

  it('returns null when the provider reports nothing', () => {
    expect(extractCost({})).toBeNull()
    expect(extractCost({ usage: {} })).toBeNull()
    expect(extractCost({ usage: { cost: 'free' } })).toBeNull()
  })
})
