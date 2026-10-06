import { NextRequest, NextResponse } from 'next/server'

import { llmTarget, modelOrDefault } from '@/app/lib/llmServer'
import { chatCompletion } from '@/app/lib/llmChat'
import { messageText } from '@/app/lib/llmResponse'
import { buildPropBriefPrompt, parsePropIdeas } from '@/app/lib/briefPrompt'

// ART DIRECTOR — call #1 of the two-call props pipeline.
//
// A *text* model looks at the biome and the categories ALREADY in the library,
// then INVENTS the next batch of decoration ideas — each one distinct from the
// others and from everything already made. The image model (call #2) then just
// paints exactly what the art director decided. Splitting ideation (reasoning)
// from rendering (image) is what stops the "same loop" of lanterns/nests/pots:
// a reasoning model can deliberately reach for fresh kinds, an image model
// cannot.

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

    const { system, user } = buildPropBriefPrompt({
      prompt,
      artStyle,
      sceneBrief,
      count: n,
      existing: existingList,
    })

    const reply = await chatCompletion({
      target,
      model: modelId,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      maxTokens: 900,
      // High temperature: this is the CREATIVE step. We want it reaching for
      // novel kinds, not playing it safe.
      temperature: 1.0,
    })
    if (!reply.ok) return NextResponse.json({ error: reply.error }, { status: reply.status })

    const ideas = parsePropIdeas(messageText(reply.message.content).trim()).slice(0, n)
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
