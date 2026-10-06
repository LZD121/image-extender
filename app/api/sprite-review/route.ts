import { NextRequest, NextResponse } from 'next/server'

import { llmTarget, modelOrDefault } from '@/app/lib/llmServer'
import { chatCompletion } from '@/app/lib/llmChat'
import { messageText, parseReviewJson } from '@/app/lib/llmResponse'
import { buildSpriteReviewPrompt } from '@/app/lib/qaRubric'

// QA ART DIRECTOR for sprite sheets — the review half of the sprite pipeline.
//
// After the image model paints the N-frame sheet (and we chroma-key + align
// it), we hand the composed sheet + the character anchor to a *vision* model.
// Its job: judge whether all frames are the SAME character (no identity
// flicker), correctly proportioned, consistently sized/grounded, free of
// fringe, and whether they read as a coherent animation for the requested
// action. If clean it approves; otherwise it returns a fix report the image
// model uses to repaint the sheet (the locked anchor identity is preserved).

// The rubric — per-body-plan animation expectations, anatomy, facing, and the
// acceptance criteria — lives in lib/qaRubric. This route only supplies the
// images and the verdict translation.
export async function POST(request: NextRequest) {
  try {
    const { prompt, anim, bodyPlan, sceneBrief, apiKey, model, sheetImage, anchorImage, provider, profile } =
      await request.json()

    if (typeof sheetImage !== 'string' || !sheetImage.startsWith('data:image/')) {
      return NextResponse.json({ error: 'Missing sprite sheet image' }, { status: 400 })
    }

    const target = llmTarget({
      provider,
      profile,
      apiKey,
      referer: request.headers.get('referer'),
      title: 'AI Image Extender - Sprite QA',
    })
    if ('error' in target) return NextResponse.json({ error: target.error }, { status: 401 })

    const modelId = modelOrDefault({ model, provider, profile, kind: 'qa' })

    const hasAnchor =
      typeof anchorImage === 'string' && anchorImage.startsWith('data:image/')

    const { system, user } = buildSpriteReviewPrompt({ prompt, anim, bodyPlan, sceneBrief, hasAnchor })

    const content: Array<Record<string, unknown>> = [
      { type: 'image_url', image_url: { url: sheetImage } },
    ]
    if (hasAnchor) {
      content.push({ type: 'image_url', image_url: { url: anchorImage } })
    }
    content.push({ type: 'text', text: user })

    const reply = await chatCompletion({
      target,
      model: modelId,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content },
      ],
      maxTokens: 600,
      temperature: 0.2,
    })
    if (!reply.ok) return NextResponse.json({ error: reply.error }, { status: reply.status })

    const review = parseReviewJson(messageText(reply.message.content))
    if (!review) {
      // Don't block the user on a parse failure — treat as approved.
      return NextResponse.json({ ok: true, issues: [], fix: '' })
    }
    return NextResponse.json(review)
  } catch (error) {
    console.error('Error in sprite-review route:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    )
  }
}
