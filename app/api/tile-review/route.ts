import { NextRequest, NextResponse } from 'next/server'

import { runVisionReview } from '@/app/lib/visionReview'
import { buildTileReviewPrompt } from '@/app/lib/qaRubric'

// QA ART DIRECTOR — the review half of the reverse two-call tile pipeline.
//
// The image model paints a tileset first; we composite it into a platform
// PREVIEW (and attach the raw sheet) and hand both to a *vision* model here.
// Its job is to judge the assembled result like a picky art director: are
// there visible seams where tiles meet, lighting/palette mismatches between
// neighbours, broken silhouettes, magenta/pink fringe, blurry or off-style
// tiles? If it's clean it APPROVES; otherwise it returns a concise fix report
// that the image model uses to repaint. This catches the cohesion problems a
// single blind generation can't see.
//
// What a review call consists of — target, QA model, images, verdict, fail-open
// — is shared with the sprite reviewer in lib/visionReview.

export async function POST(request: NextRequest) {
  try {
    const { prompt, sceneBrief, apiKey, model, previewImage, sheetImage, provider, profile } =
      await request.json()

    if (
      typeof previewImage !== 'string' ||
      !previewImage.startsWith('data:image/')
    ) {
      return NextResponse.json(
        { error: 'Missing preview image' },
        { status: 400 }
      )
    }

    const hasSheet = typeof sheetImage === 'string' && sheetImage.startsWith('data:image/')
    const review = buildTileReviewPrompt({ prompt, sceneBrief, hasSheet })

    const result = await runVisionReview({
      provider,
      apiKey,
      profile,
      model,
      referer: request.headers.get('referer'),
      title: 'AI Image Extender - Tile QA',
      images: hasSheet ? [previewImage, sheetImage] : [previewImage],
      prompt: review,
    })
    if ('error' in result) return NextResponse.json({ error: result.error }, { status: result.status })
    return NextResponse.json(result)
  } catch (error) {
    console.error('Error in tile-review route:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    )
  }
}
