import { describe, expect, it } from 'vitest'
import { buildPropBriefPrompt, buildSceneBriefPrompt, parsePropIdeas } from '@/app/lib/briefPrompt'

describe('buildPropBriefPrompt', () => {
  it('asks for the batch size the route clamped, and lists what already exists', () => {
    const { system, user } = buildPropBriefPrompt({
      prompt: 'a mossy cave',
      artStyle: 'pixel-art',
      sceneBrief: 'moody dusk',
      count: 4,
      existing: ['fern', 'boulder'],
    })
    expect(system).toContain('Propose EXACTLY 4 props')
    expect(system).toContain('STRICT JSON')
    expect(user).toContain('World / biome: "a mossy cave"')
    expect(user).toContain('Art style: pixel art: crisp hard-edged pixel blocks')
    expect(user).toContain('Shared scene direction: moody dusk')
    expect(user).toContain('ALREADY contains these decoration kinds')
    expect(user).toContain('fern, boulder')
    expect(user).toContain('Propose 4 brand-new decoration props')
  })

  it('omits the style, scene and existing blocks when the route passes none', () => {
    const { user } = buildPropBriefPrompt({ prompt: 'a cave', count: 8, existing: [] })
    expect(user).not.toContain('Art style:')
    expect(user).not.toContain('Shared scene direction:')
    expect(user).not.toContain('ALREADY contains')
  })
})

describe('buildSceneBriefPrompt', () => {
  it('distils the brief from the anchor prompt, styled when asked', () => {
    const { system, user } = buildSceneBriefPrompt({ anchorPrompt: 'a windswept cliff', artStyle: 'low-poly' })
    expect(system).toContain('3–5 sentences')
    expect(user).toContain('"a windswept cliff"')
    expect(user).toContain('low-poly: flat geometric facets')
    expect(buildSceneBriefPrompt({ anchorPrompt: 'a cliff' }).user).not.toContain('Art style:')
  })
})

describe('parsePropIdeas', () => {
  it('reads a bare array, a fenced array, and an object carrying props', () => {
    expect(parsePropIdeas('[{"category":"fern","description":"a curled fern"}]')).toEqual([
      { category: 'fern', description: 'a curled fern' },
    ])
    expect(parsePropIdeas('```json\n[{"description":"a mossy rock"}]\n```')).toEqual([
      { category: 'a', description: 'a mossy rock' },
    ])
    expect(parsePropIdeas('{"props":[{"category":"reed","description":"tall reeds"}]}')).toEqual([
      { category: 'reed', description: 'tall reeds' },
    ])
  })

  it('accepts the synonyms a text model substitutes for the schema', () => {
    expect(parsePropIdeas('[{"kind":" Rock ","brief":"a grey boulder"}]')).toEqual([
      { category: 'rock', description: 'a grey boulder' },
    ])
  })

  it('finds the block a chatty model wrapped, and derives a category when none was named', () => {
    expect(parsePropIdeas('Here are the ideas you asked for:\n[{"description":"from the array"}]')).toEqual([
      { category: 'from', description: 'from the array' },
    ])
  })

  it('drops what it cannot read instead of inventing ideas', () => {
    // First `[` to last `]` spans both shapes here, so neither block parses.
    expect(parsePropIdeas('[{"description":"array"}] and {"props":[{"description":"object"}]}')).toEqual([])
    expect(parsePropIdeas('I had no ideas.')).toEqual([])
    expect(parsePropIdeas('[{"category":"fern"}]')).toEqual([])
    expect(parsePropIdeas('')).toEqual([])
  })
})
