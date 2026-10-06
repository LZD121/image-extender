// app/lib/briefPrompt.ts
/**
 * The art director: the two text-model briefs this app asks for, and how the
 * answers are read back.
 *
 * Both calls decide *what* to make next — the shared scene direction every
 * parallax layer must follow, and the batch of decoration props to paint — and
 * both prompts lived in their route handlers, where they could only be
 * exercised through HTTP. They are here now, pure: same inputs in, the same two
 * prompt strings out, and one reader for the ideas that come back.
 */
import { salvageJson } from '@/app/lib/llmResponse'
import { ART_STYLE_PROMPTS } from '@/app/lib/stylePrompt'

/** One decoration idea the art director proposed. */
export interface PropIdea {
  category: string
  description: string
}

/** The two prompt halves a brief call sends: system = the job, user = the material. */
export type BriefPrompt = {
  system: string
  user: string
}

/**
 * The decoration brief. `count` is already clamped and `existing` already
 * normalized by the route, which needs both for the reply as well.
 */
export function buildPropBriefPrompt(opts: {
  prompt: string
  artStyle?: string
  sceneBrief?: unknown
  count: number
  existing: string[]
}): BriefPrompt {
    const { prompt, artStyle, sceneBrief, count: n, existing: existingList } = opts

    const styleLine =
      artStyle && ART_STYLE_PROMPTS[artStyle]
        ? `\nArt style: ${ART_STYLE_PROMPTS[artStyle]}.`
        : ''

    const sceneLine =
      typeof sceneBrief === 'string' && sceneBrief.trim()
        ? `\nShared scene direction: ${sceneBrief.trim()}`
        : ''

    const existingBlock = existingList.length
      ? `\n\nThe library ALREADY contains these decoration kinds — do NOT propose any of these, or any obvious variant/re-skin of them:\n${existingList.join(', ')}.`
      : ''

    const systemPrompt = `You are the ART DIRECTOR for the decoration set of a side-view 2D platformer. Your job is to decide WHICH decoration props to create next so the set stays rich, surprising and never repetitive.

You will be given the biome/world description and the list of decoration kinds already made. Propose the NEXT batch of brand-new props.

Hard rules:
- Propose EXACTLY ${n} props.
- Every prop must be a DIFFERENT KIND from each other AND from everything already in the library. No near-duplicates, no re-skins, no "another X".
- Deliberately reach for under-used, unexpected-but-fitting object kinds. Think broadly across: plants & fungi, minerals & gems, wood & roots, bones & remains, water features, weather/effects, man-made debris, tools & implements, containers, totems/idols, signage, woven/cloth items, food/forage, creature traces (eggs, shells, webs, tracks), light sources, ritual objects, broken architecture, etc. — but always TRUE to the given world.
- Each prop is a SINGLE standalone object suitable to scatter on a tile map (no scenes, no characters, no backgrounds).

Output STRICT JSON only — no prose, no markdown fences. Schema:
{"props":[{"category":"<single lowercase word for the kind>","description":"<one vivid sentence, 8-16 words, describing the object to paint>"}]}`

    const userPrompt = `World / biome: "${prompt.trim()}"${styleLine}${sceneLine}${existingBlock}

Propose ${n} brand-new decoration props as strict JSON.`

    return { system: systemPrompt, user: userPrompt }
}

/** The shared scene direction every layer of a parallax project must follow. */
export function buildSceneBriefPrompt(opts: {
  anchorPrompt: string
  artStyle?: string
}): BriefPrompt {
    const { anchorPrompt, artStyle } = opts

    const styleLine =
      artStyle && ART_STYLE_PROMPTS[artStyle]
        ? `\nArt style: ${ART_STYLE_PROMPTS[artStyle]}.`
        : ''

    const systemPrompt = `You help game designers build multi-layer parallax backgrounds. Given the prompt used for the NEAR (foreground) anchor layer, write a concise SCENE BRIEF that every other layer (mid-ground, far distance, sky/back) must follow so the final composite feels like one cohesive world.

Rules for your brief:
- 3–5 sentences, plain text only — no markdown, no bullet lists, no headers.
- Capture: setting/environment, time of day, lighting quality, color palette (name specific colors), art style, mood/atmosphere.
- Lighting must be ambient and horizontally even (no sun/moon on one side) because the sky layer will tile horizontally in-game.
- Write as instructions an artist would follow when painting matching layers behind the foreground — not layer-specific composition rules.
- Do NOT repeat the anchor prompt verbatim; distill the shared art direction.`

    const userPrompt = `Near (foreground) layer prompt:
"${anchorPrompt.trim()}"${styleLine}

Write the shared scene brief for all parallax layers.`

    return { system: systemPrompt, user: userPrompt }
}

/**
 * The decoration ideas out of an art-director reply — a bare JSON array, or an
 * object carrying a `props` array. Category and description each accept a
 * synonym, because a text model does not always keep to the schema it was given.
 */
export function parsePropIdeas(raw: string): PropIdea[] {
  const data = salvageJson(raw, ['array', 'object'])
  const arr: unknown[] = Array.isArray(data)
    ? data
    : data && typeof data === 'object' && 'props' in data && Array.isArray(data.props)
      ? data.props
      : []
  const ideas: PropIdea[] = []
  for (const item of arr) {
    if (!item || typeof item !== 'object') continue
    const category =
      'category' in item && typeof item.category === 'string'
        ? item.category.trim().toLowerCase()
        : 'kind' in item && typeof item.kind === 'string'
          ? item.kind.trim().toLowerCase()
          : ''
    const description =
      'description' in item && typeof item.description === 'string'
        ? item.description.trim()
        : 'brief' in item && typeof item.brief === 'string'
          ? item.brief.trim()
          : ''
    if (description) {
      ideas.push({ category: category || description.split(/\s+/)[0].toLowerCase(), description })
    }
  }
  return ideas
}
