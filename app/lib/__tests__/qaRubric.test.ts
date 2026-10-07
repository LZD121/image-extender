import { describe, expect, it } from 'vitest'
import { buildTileReviewPrompt } from '@/app/lib/qaRubric'

describe('buildTileReviewPrompt', () => {
  it('mentions the raw sheet only when one was attached', () => {
    expect(buildTileReviewPrompt({ prompt: 'moss', sceneBrief: 'dusk', hasSheet: true }).user).toContain(
      '(and the raw tile sheet)',
    )
    expect(buildTileReviewPrompt({ prompt: 'moss', hasSheet: false }).user).not.toContain('raw tile sheet')
  })

  it('keeps the reviewer off the corners the app composites itself', () => {
    const { system } = buildTileReviewPrompt({ prompt: 'moss', hasSheet: false })
    expect(system).toContain('the painter does not, and cannot, draw a corner')
    expect(system).toContain('Do NOT mention corners')
  })
})
