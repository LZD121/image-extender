import { describe, expect, it } from 'vitest'
import { buildSpriteReviewPrompt, buildTileReviewPrompt } from '@/app/lib/qaRubric'

const sheet = { prompt: 'a knight', anim: 'walk', bodyPlan: 'biped', hasAnchor: false }

describe('buildSpriteReviewPrompt', () => {
  it('judges the sheet against the animation and body plan the user asked for', () => {
    const quadruped = buildSpriteReviewPrompt({ ...sheet, bodyPlan: 'quadruped', anim: 'sleep' })
    expect(quadruped.system).toContain('a slow sleep loop')
    expect(quadruped.system).toContain('four-legged creature')
    expect(quadruped.user).toContain('Animation: sleep')
  })

  it('falls back to the biped rules and a generic expectation for an unknown plan or anim', () => {
    const unknown = buildSpriteReviewPrompt({ ...sheet, bodyPlan: 'nonesuch', anim: 'nonesuch' })
    expect(unknown.system).toContain('a coherent character animation sequence read left-to-right')
    expect(unknown.system).toContain('left vs right arm/leg stay distinguishable')
  })

  it('tells the reviewer when an anchor image is attached', () => {
    const withAnchor = buildSpriteReviewPrompt({ ...sheet, hasAnchor: true })
    expect(withAnchor.system).toContain('You are ALSO shown the CHARACTER ANCHOR')
    expect(withAnchor.user).toContain('against the character anchor')
    expect(buildSpriteReviewPrompt(sheet).user).not.toContain('against the character anchor')
  })

  it('names the magenta key as the automatic reject', () => {
    expect(buildSpriteReviewPrompt(sheet).system).toContain('pure magenta #FF00FF')
  })
})

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
