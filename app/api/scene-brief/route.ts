import { NextRequest, NextResponse } from 'next/server'

import { llmTarget } from '@/app/lib/llmServer'
import { ART_STYLE_PROMPTS } from '@/app/lib/stylePrompt'

const DEFAULT_MODEL = 'google/gemini-2.0-flash-001'

export async function POST(request: NextRequest) {
  try {
    const { anchorPrompt, artStyle, apiKey, model, provider } = await request.json()

    if (!anchorPrompt || typeof anchorPrompt !== 'string' || !anchorPrompt.trim()) {
      return NextResponse.json(
        { error: 'Missing anchor prompt' },
        { status: 400 }
      )
    }

    const target = llmTarget({
      provider,
      apiKey,
      referer: request.headers.get('referer'),
      title: 'AI Image Extender - Scene Brief',
    })
    if ('error' in target) return NextResponse.json({ error: target.error }, { status: 401 })

    const modelId =
      typeof model === 'string' && model.trim() ? model.trim() : DEFAULT_MODEL

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

    const response = await fetch(target.url, {
      method: 'POST',
      headers: target.headers,
      body: JSON.stringify({
        model: modelId,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        max_tokens: 400,
        // Some gateways (APIMart) default to SSE, which is not JSON to parse.
        stream: false,
        temperature: 0.4,
      }),
    })

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}))
      return NextResponse.json(
        { error: errorData.error?.message || 'Failed to generate scene brief' },
        { status: response.status }
      )
    }

    const data = await response.json()
    const content = data.choices?.[0]?.message?.content
    const sceneBrief =
      typeof content === 'string'
        ? content.trim()
        : Array.isArray(content)
          ? content
              .map((p: { text?: string; type?: string }) =>
                typeof p?.text === 'string' ? p.text : ''
              )
              .join('')
              .trim()
          : ''

    if (!sceneBrief) {
      return NextResponse.json(
        { error: 'No scene brief returned from model' },
        { status: 500 }
      )
    }

    return NextResponse.json({ sceneBrief })
  } catch (error) {
    console.error('Error in scene-brief route:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    )
  }
}
