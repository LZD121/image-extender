import { NextRequest, NextResponse } from 'next/server'

import { llmTarget, modelOrDefault } from '@/app/lib/llmServer'
import { chatCompletion } from '@/app/lib/llmChat'
import { messageText, parseReviewJson } from '@/app/lib/llmResponse'
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
// The one review call the app makes lives here rather than behind a shared
// module: the sprite reviewer it was extracted for was cut, and a seam with one
// adapter is a hypothetical one.

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

    const target = llmTarget({
      provider,
      profile,
      apiKey,
      referer: request.headers.get('referer'),
      title: 'AI Image Extender - Tile QA',
    })
    if ('error' in target) return NextResponse.json({ error: target.error }, { status: 401 })

    const modelId = modelOrDefault({ model, provider, profile, kind: 'qa' })

    const hasSheet = typeof sheetImage === 'string' && sheetImage.startsWith('data:image/')
    const { system, user } = buildTileReviewPrompt({ prompt, sceneBrief, hasSheet })

    const content: Array<Record<string, unknown>> = [
      { type: 'image_url', image_url: { url: previewImage } },
    ]
    if (hasSheet) {
      content.push({ type: 'image_url', image_url: { url: sheetImage } })
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
      // Low temperature: this is a judgment call, we want consistency.
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
    console.error('Error in tile-review route:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    )
  }
}
