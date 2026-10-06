import { NextRequest, NextResponse } from 'next/server'

import { llmTarget, modelOrDefault } from '@/app/lib/llmServer'
import { chatCompletion } from '@/app/lib/llmChat'
import { messageText } from '@/app/lib/llmResponse'
import { ART_STYLE_PROMPTS } from '@/app/lib/stylePrompt'

// ART DIRECTOR — call #1 of the two-call props pipeline.
//
// A *text* model looks at the biome and the categories ALREADY in the library,
// then INVENTS the next batch of decoration ideas — each one distinct from the
// others and from everything already made. The image model (call #2) then just
// paints exactly what the art director decided. Splitting ideation (reasoning)
// from rendering (image) is what stops the "same loop" of lanterns/nests/pots:
// a reasoning model can deliberately reach for fresh kinds, an image model
// cannot.

interface PropIdea {
  category: string
  description: string
}

/** Best-effort JSON extraction — strips ```json fences and grabs the first
 * {...} or [...] block, since text models sometimes wrap or pad their output. */
function parseIdeas(raw: string): PropIdea[] {
  if (!raw) return []
  let text = raw.trim()
  // Strip markdown code fences if present.
  text = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '')
  // Try direct parse, then a substring between the first [ and last ].
  const tryParse = (s: string): unknown => {
    try {
      return JSON.parse(s)
    } catch {
      return null
    }
  }
  let data: unknown = tryParse(text)
  if (!data) {
    const arrStart = text.indexOf('[')
    const arrEnd = text.lastIndexOf(']')
    if (arrStart !== -1 && arrEnd > arrStart) {
      data = tryParse(text.slice(arrStart, arrEnd + 1))
    }
  }
  if (!data) {
    const objStart = text.indexOf('{')
    const objEnd = text.lastIndexOf('}')
    if (objStart !== -1 && objEnd > objStart) {
      data = tryParse(text.slice(objStart, objEnd + 1))
    }
  }
  // Accept either a bare array or an object with a `props` array.
  const arr: unknown[] = Array.isArray(data)
    ? data
    : data && typeof data === 'object' && Array.isArray((data as Record<string, unknown>).props)
      ? ((data as Record<string, unknown>).props as unknown[])
      : []
  const ideas: PropIdea[] = []
  for (const item of arr) {
    if (!item || typeof item !== 'object') continue
    const o = item as Record<string, unknown>
    const category =
      typeof o.category === 'string'
        ? o.category.trim().toLowerCase()
        : typeof o.kind === 'string'
          ? o.kind.trim().toLowerCase()
          : ''
    const description =
      typeof o.description === 'string'
        ? o.description.trim()
        : typeof o.brief === 'string'
          ? o.brief.trim()
          : ''
    if (description) {
      ideas.push({ category: category || description.split(/\s+/)[0].toLowerCase(), description })
    }
  }
  return ideas
}

export async function POST(request: NextRequest) {
  try {
    const { prompt, sceneBrief, artStyle, apiKey, model, count, existing, provider, profile } =
      await request.json()

    if (!prompt || typeof prompt !== 'string' || !prompt.trim()) {
      return NextResponse.json({ error: 'Missing biome prompt' }, { status: 400 })
    }

    const target = llmTarget({
      provider,
      profile,
      apiKey,
      referer: request.headers.get('referer'),
      title: 'AI Image Extender - Prop Art Director',
    })
    if ('error' in target) return NextResponse.json({ error: target.error }, { status: 401 })

    const modelId = modelOrDefault({ model, provider, profile, kind: 'qa' })

    const n = Math.max(1, Math.min(24, Math.round(Number(count) || 8)))
    const existingList: string[] = Array.isArray(existing)
      ? existing
          .map((s) => (typeof s === 'string' ? s.trim().toLowerCase() : ''))
          .filter(Boolean)
      : []

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

    const reply = await chatCompletion({
      target,
      model: modelId,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      maxTokens: 900,
      // High temperature: this is the CREATIVE step. We want it reaching for
      // novel kinds, not playing it safe.
      temperature: 1.0,
    })
    if (!reply.ok) return NextResponse.json({ error: reply.error }, { status: reply.status })

    const ideas = parseIdeas(messageText(reply.message.content).trim()).slice(0, n)
    if (ideas.length === 0) {
      return NextResponse.json(
        { error: 'Art director returned no usable ideas' },
        { status: 500 }
      )
    }

    return NextResponse.json({ ideas })
  } catch (error) {
    console.error('Error in prop-brief route:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    )
  }
}
