import { NextRequest, NextResponse } from 'next/server'

import { runVisionReview } from '@/app/lib/visionReview'
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
//
// The rubric — per-body-plan animation expectations, anatomy, facing, and the
// acceptance criteria — lives in lib/qaRubric; the mechanics of the call live
// in lib/visionReview, shared with the tile reviewer.
export async function POST(request: NextRequest) {
  try {
    const { prompt, anim, bodyPlan, sceneBrief, apiKey, model, sheetImage, anchorImage, provider, profile } =
      await request.json()

    if (typeof sheetImage !== 'string' || !sheetImage.startsWith('data:image/')) {
      return NextResponse.json({ error: 'Missing sprite sheet image' }, { status: 400 })
    }

    const hasAnchor =
      typeof anchorImage === 'string' && anchorImage.startsWith('data:image/')

    const review = buildSpriteReviewPrompt({ prompt, anim, bodyPlan, sceneBrief, hasAnchor })

    const result = await runVisionReview({
      provider,
      apiKey,
      profile,
      model,
      referer: request.headers.get('referer'),
      title: 'AI Image Extender - Sprite QA',
      images: hasAnchor ? [sheetImage, anchorImage] : [sheetImage],
      prompt: review,
    })
    if ('error' in result) return NextResponse.json({ error: result.error }, { status: result.status })
    return NextResponse.json(result)
  } catch (error) {
    console.error('Error in sprite-review route:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    )
  }
}
