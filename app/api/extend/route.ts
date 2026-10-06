import { NextRequest, NextResponse } from 'next/server'

import { modelOrDefault } from '@/app/lib/llmServer'
import { generateImage } from '@/app/lib/imageGeneration'
import { buildExtendPrompt, isDirection } from '@/app/lib/extendPrompt'

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const {
      expandedCanvas,
      direction,
      extensionAmount,
      chunkInfo,
      extensionInfo,
      attempt = 0,
      apiKey,
      model,
      provider,
      profile,
    } = body

    if (!expandedCanvas || !extensionAmount) {
      return NextResponse.json(
        { error: 'Missing required fields' },
        { status: 400 }
      )
    }

    if (!isDirection(direction)) {
      return NextResponse.json(
        { error: `Unknown direction: ${String(direction)}` },
        { status: 400 }
      )
    }

    const modelId = modelOrDefault({ model, provider, profile, kind: 'image' })

    // The outpainting prompt lives in lib/extendPrompt — pure, testable, and the
    // one place the four directions are spelled out.
    const prompt = buildExtendPrompt({ ...body, direction })

    // One request either way: the dispatch resolves the credentials once and
    // picks the adapter this gateway needs. APIMart also needs the target
    // canvas in pixels, which only the full-context path states — the dispatch
    // carries that guard, because only the adapter can say why.
    const image = await generateImage({
      provider,
      profile,
      apiKey,
      referer: request.headers.get('referer'),
      title: 'AI Image Extender',
      model: modelId,
      prompt,
      width: extensionInfo?.newWidth,
      height: extensionInfo?.newHeight,
      temperature: attempt === 0 ? 0.3 : attempt === 1 ? 0.5 : 0.7,
      references: [expandedCanvas],
      content: [
        { type: 'image_url', image_url: { url: expandedCanvas } },
        { type: 'text', text: prompt },
      ],
    })
    if ('error' in image) {
      if (image.reason === 'no-image') {
        const message = image.message ?? {}
        console.error('No image URL found. Message structure:', JSON.stringify(sanitizeForLogging(message), null, 2))
        return NextResponse.json(
          {
            error: 'The model responded without an image. It may not support image extension yet.',
            debug: {
              hasContent: !!message.content,
              contentType: Array.isArray(message.content) ? 'array' : typeof message.content,
            },
          },
          { status: 500 }
        )
      }
      return NextResponse.json({ error: image.error }, { status: image.status })
    }

    return NextResponse.json({ imageUrl: image.imageUrl, chunkInfo, provider: image.provider })
  } catch (error) {
    console.error('Error in extend route:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    )
  }
}

/** Truncate base64 in nested objects so server logs stay readable. */
function sanitizeForLogging(obj: any, depth = 0): any {
  if (depth > 10) return '[MAX_DEPTH]'
  if (typeof obj === 'string') {
    if (obj.length > 500) return `[STRING_DATA: ${obj.length} chars]`
    if (obj.startsWith('data:image')) return `[DATA_URL: ${obj.length} chars]`
    return obj
  }
  if (Array.isArray(obj)) return obj.map((item) => sanitizeForLogging(item, depth + 1))
  if (obj && typeof obj === 'object') {
    const out: any = {}
    for (const key in obj) {
      out[key] = typeof obj[key] === 'string' && obj[key].length > 500
        ? `[LONG_STRING: ${obj[key].length} chars]`
        : sanitizeForLogging(obj[key], depth + 1)
    }
    return out
  }
  return obj
}

